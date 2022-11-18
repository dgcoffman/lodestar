import {computeAggregateKzgProof} from "c-kzg";
import {BLSPubkey, Slot, BLSSignature, allForks, bellatrix, isBlindedBeaconBlock, eip4844, ssz} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {ForkName, ForkSeq} from "@lodestar/params";
import {extendError, prettyBytes} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {Api} from "@lodestar/api";
import {Blobs, BlobsSidecar} from "@lodestar/types/eip4844";
import {blindedOrFullBlockHashTreeRoot} from "@lodestar/state-transition";
import {IClock, ILoggerVc} from "../util/index.js";
import {PubkeyHex} from "../types.js";
import {Metrics} from "../metrics.js";
import {ValidatorStore} from "./validatorStore.js";
import {BlockDutiesService, GENESIS_SLOT} from "./blockDuties.js";

/**
 * Service that sets up and handles validator block proposal duties.
 */
export class BlockProposingService {
  private readonly dutiesService: BlockDutiesService;

  constructor(
    private readonly config: IChainForkConfig,
    private readonly logger: ILoggerVc,
    private readonly api: Api,
    private readonly clock: IClock,
    private readonly validatorStore: ValidatorStore,
    private readonly metrics: Metrics | null
  ) {
    this.dutiesService = new BlockDutiesService(
      logger,
      api,
      clock,
      validatorStore,
      metrics,
      this.notifyBlockProductionFn
    );
  }

  removeDutiesForKey(pubkey: PubkeyHex): void {
    this.dutiesService.removeDutiesForKey(pubkey);
  }

  /**
   * `BlockDutiesService` must call this fn to trigger block creation
   * This function may run more than once at a time, rationale in `BlockDutiesService.pollBeaconProposers`
   */
  private notifyBlockProductionFn = (slot: Slot, proposers: BLSPubkey[]): void => {
    if (slot <= GENESIS_SLOT) {
      this.logger.debug("Not producing block before or at genesis slot");
      return;
    }

    if (proposers.length > 1) {
      this.logger.warn("Multiple block proposers", {slot, count: proposers.length});
    }

    Promise.all(proposers.map((pubkey) => this.createAndPublishBlock(pubkey, slot))).catch((e: Error) => {
      this.logger.error("Error on block duties", {slot}, e);
    });
  };

  /** Produce a block at the given slot for pubkey */
  private async createAndPublishBlock(pubkey: BLSPubkey, slot: Slot): Promise<void> {
    const pubkeyHex = toHexString(pubkey);
    const logCtx = {slot, validator: prettyBytes(pubkeyHex)};

    // Wrap with try catch here to re-use `logCtx`
    try {
      const randaoReveal = await this.validatorStore.signRandao(pubkey, slot);
      const graffiti = this.validatorStore.getGraffiti(pubkeyHex);

      const debugLogCtx = {...logCtx, validator: pubkeyHex};

      this.logger.debug("Producing block", debugLogCtx);
      this.metrics?.proposerStepCallProduceBlock.observe(this.clock.secFromSlot(slot));

      const strictFeeRecipientCheck = this.validatorStore.strictFeeRecipientCheck(pubkeyHex);
      const isBuilderEnabled = this.validatorStore.isBuilderEnabled(pubkeyHex);
      const expectedFeeRecipient = this.validatorStore.getFeeRecipient(pubkeyHex);

      const {block, blobs, blockDebugLogCtx} = await this.produceBlockWrapper(slot, randaoReveal, graffiti, {
        expectedFeeRecipient,
        strictFeeRecipientCheck,
        isBuilderEnabled,
      }).catch((e: Error) => {
        this.metrics?.blockProposingErrors.inc({error: "produce"});
        throw extendError(e, "Failed to produce block");
      });

      this.logger.debug("Produced block", {...debugLogCtx, ...blockDebugLogCtx});
      this.metrics?.blocksProduced.inc();

      const signedBlock = await this.validatorStore.signBlock(pubkey, block, slot);

      this.metrics?.proposerStepCallPublishBlock.observe(this.clock.secFromSlot(slot));

      const onPublishError = (e: Error): void => {
        this.metrics?.blockProposingErrors.inc({error: "publish"});
        throw extendError(e, "Failed to publish block");
      };

      if (this.config.getForkSeq(block.slot) >= ForkSeq.eip4844) {
        if (!blobs) {
          return onPublishError(new Error("Produced an EIP-4844 block but it was missing blobs!"));
        }

        const signedBlockWithBlobs = ssz.eip4844.SignedBeaconBlockAndBlobsSidecar.defaultValue();
        signedBlockWithBlobs.beaconBlock = signedBlock as eip4844.SignedBeaconBlock;
        signedBlockWithBlobs.blobsSidecar = this.getBlobsSidecar(block, blobs);

        // TODO EIP-4844: Blinded blocks??? No clue!
        await this.api.beacon.publishBlockWithBlobs(signedBlockWithBlobs).catch(onPublishError);
      } else {
        await this.publishBlockWrapper(signedBlock).catch(onPublishError);
      }

      this.logger.info("Published block", {...logCtx, graffiti, ...blockDebugLogCtx});
      this.metrics?.blocksPublished.inc();
    } catch (e) {
      this.logger.error("Error proposing block", logCtx, e as Error);
    }
  }

  /**
   * https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#sidecar
   * def get_blobs_sidecar(block: BeaconBlock, blobs: Sequence[Blob]) -> BlobsSidecar:
   *   return BlobsSidecar(
   *       beacon_block_root=hash_tree_root(block),
   *       beacon_block_slot=block.slot,
   *       blobs=blobs,
   *       kzg_aggregated_proof=compute_proof_from_blobs(blobs),
   *   )
   */
  private getBlobsSidecar(block: allForks.FullOrBlindedBeaconBlock, blobs: Blobs): BlobsSidecar {
    return {
      beaconBlockRoot: blindedOrFullBlockHashTreeRoot(this.config, block),
      beaconBlockSlot: block.slot,
      blobs,
      kzgAggregatedProof: computeAggregateKzgProof(blobs),
    };
  }

  private publishBlockWrapper = async (signedBlock: allForks.FullOrBlindedSignedBeaconBlock): Promise<void> => {
    return isBlindedBeaconBlock(signedBlock.message)
      ? this.api.beacon.publishBlindedBlock(signedBlock as bellatrix.SignedBlindedBeaconBlock)
      : this.api.beacon.publishBlock(signedBlock as allForks.SignedBeaconBlock);
  };

  private produceBlockWrapper = async (
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    {
      expectedFeeRecipient,
      strictFeeRecipientCheck,
      isBuilderEnabled,
    }: {expectedFeeRecipient: string; strictFeeRecipientCheck: boolean; isBuilderEnabled: boolean}
  ): Promise<{
    block: allForks.FullOrBlindedBeaconBlock;
    blockDebugLogCtx: Record<string, string>;
    blobs: eip4844.Blobs | undefined;
  }> => {
    // TODO EIP-4844: How does 4844 interact with the Builder API?
    const blindedBlockPromise = isBuilderEnabled
      ? this.api.validator.produceBlindedBlock(slot, randaoReveal, graffiti).catch((e: Error) => {
          this.logger.error("Failed to produce builder block", {}, e as Error);
          return null;
        })
      : null;

    const fullBlockPromise = this.produceBlock(slot, randaoReveal, graffiti).catch((e: Error) => {
      this.logger.error("Failed to produce builder block", {}, e as Error);
      return null;
    });

    await Promise.all([blindedBlockPromise, fullBlockPromise]);

    const blindedBlock = await blindedBlockPromise;
    const fullBlock = await fullBlockPromise;

    // A metric on the choice between blindedBlock and normal block can be applied
    if (blindedBlock) {
      const blockDebugLogCtx = {source: "builder"};
      // TODO EIP-4844: What are we doing with blobs for blinded blocks?
      return {block: blindedBlock.data, blockDebugLogCtx, blobs: []};
    } else {
      const blockDebugLogCtx = {source: "engine"};
      if (!fullBlock) {
        throw Error("Failed to produce engine or builder block");
      }
      const blockFeeRecipient = (fullBlock.data as bellatrix.BeaconBlock).body.executionPayload?.feeRecipient;
      const feeRecipient = blockFeeRecipient !== undefined ? toHexString(blockFeeRecipient) : undefined;
      if (feeRecipient !== undefined) {
        // In Mev Builder, the feeRecipient could differ and rewards to the feeRecipient
        // might be included in the block transactions as indicated by the BuilderBid
        // Address this appropriately in the Mev boost PR
        //
        // Even for engine, there could be divergence of feeRecipient the argument being
        // that the bn <> engine setup has implied trust and are user-agents of the same entity.
        // A better approach would be to have engine also provide something akin to BuilderBid
        //
        // The following conversation in the interop R&D channel can provide some context
        // https://discord.com/channels/595666850260713488/892088344438255616/978374892678426695
        //
        // For now providing a strick check flag to enable disable this
        if (feeRecipient !== expectedFeeRecipient && strictFeeRecipientCheck) {
          throw Error(`Invalid feeRecipient=${feeRecipient}, expected=${expectedFeeRecipient}`);
        }
        Object.assign(blockDebugLogCtx, {feeRecipient});
      }
      return {block: fullBlock.data, blockDebugLogCtx, blobs: fullBlock.blobs};
    }
  };

  /** Wrapper around the API's different methods for producing blocks across forks */
  private produceBlock = async (
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string
  ): Promise<{data: allForks.BeaconBlock; blobs?: Blobs}> => {
    switch (this.config.getForkName(slot)) {
      case ForkName.phase0:
        return this.api.validator.produceBlock(slot, randaoReveal, graffiti);
      case ForkName.altair:
      case ForkName.bellatrix:
      case ForkName.capella:
        return this.api.validator.produceBlockV2(slot, randaoReveal, graffiti);
      default:
        // EIP-4844 and later
        return this.api.validator.produceBlockWithBlobs(slot, randaoReveal, graffiti);
    }
  };
}
