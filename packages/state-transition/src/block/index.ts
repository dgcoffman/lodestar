import {ForkSeq} from "@lodestar/params";
import {allForks, altair, eip4844, ssz} from "@lodestar/types";
import {BlobsSidecar} from "@lodestar/types/eip4844";
import {ExecutionEngine} from "../util/executionEngine.js";
import {getFullOrBlindedPayload, isExecutionEnabled} from "../util/execution.js";
import {CachedBeaconStateAllForks, CachedBeaconStateBellatrix} from "../types.js";
import {isDataAvailable} from "../util/blobs/isDataAvailable.js";
import {processBlobKzgCommitments} from "./processBlobKzgCommitments.js";
import {processExecutionPayload} from "./processExecutionPayload.js";
import {processSyncAggregate} from "./processSyncCommittee.js";
import {processBlockHeader} from "./processBlockHeader.js";
import {processEth1Data} from "./processEth1Data.js";
import {processOperations} from "./processOperations.js";
import {processRandao} from "./processRandao.js";
// Spec tests
export {processBlockHeader, processExecutionPayload, processRandao, processEth1Data, processSyncAggregate};
export * from "./processOperations.js";

export * from "./initiateValidatorExit.js";
export * from "./isValidIndexedAttestation.js";

// EIP-4844 to allow beacon-node to import this function in
// packages/beacon-node/src/chain/produceBlock/validateBlobsAndKzgCommitments.ts
// I'm sure there's a beter way to do this.
export {verifyKzgCommitmentsAgainstTransactions} from "./processBlobKzgCommitments.js";

export function processBlock(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  block: allForks.FullOrBlindedBeaconBlock,
  verifySignatures = true,
  executionEngine: ExecutionEngine | null,
  blobsSidecar: BlobsSidecar | undefined,
  verifyBlobs = true
): void {
  processBlockHeader(state, block);

  // The call to the process_execution_payload must happen before the call to the process_randao as the former depends
  // on the randao_mix computed with the reveal of the previous block.
  if (fork >= ForkSeq.bellatrix) {
    const fullOrBlindedPayload = getFullOrBlindedPayload(block);

    if (isExecutionEnabled(state as CachedBeaconStateBellatrix, block)) {
      processExecutionPayload(state as CachedBeaconStateBellatrix, fullOrBlindedPayload, executionEngine);
    }
  }

  processRandao(state, block, verifySignatures);
  processEth1Data(state, block.body.eth1Data);
  processOperations(fork, state, block.body, verifySignatures);
  if (fork >= ForkSeq.altair) {
    processSyncAggregate(state, block as altair.BeaconBlock, verifySignatures);
  }

  // EIP-4844 Block processing
  // https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#block-processing
  if (fork >= ForkSeq.eip4844) {
    const body = block.body as eip4844.BeaconBlockBody;
    processBlobKzgCommitments(body);

    // New in EIP-4844, note: Can sync optimistically without this condition, see note on `is_data_available`
    if (
      verifyBlobs &&
      !isDataAvailable(
        blobsSidecar,
        block.slot,
        ssz.eip4844.BeaconBlock.hashTreeRoot(block as eip4844.BeaconBlock),
        body.blobKzgCommitments
      )
    ) {
      throw new Error("Expected blobs sidecar not found for EIP-4844 block");
    }
  }
}
