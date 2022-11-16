import {verifyAggregateKzgProof} from "c-kzg";
import {ForkSeq} from "@lodestar/params";
import {allForks, altair, eip4844, Root, ssz} from "@lodestar/types";
import {BlobsSidecar, KZGCommitment} from "@lodestar/types/eip4844";
import {ExecutionEngine} from "../util/executionEngine.js";
import {getFullOrBlindedPayload, isExecutionEnabled} from "../util/execution.js";
import {BlobsSidecarRetrievalFunction, CachedBeaconStateAllForks, CachedBeaconStateBellatrix} from "../types.js";
import {processExecutionPayload} from "./processExecutionPayload.js";
import {processSyncAggregate} from "./processSyncCommittee.js";
import {processBlockHeader} from "./processBlockHeader.js";
import {processEth1Data} from "./processEth1Data.js";
import {processOperations} from "./processOperations.js";
import {processRandao} from "./processRandao.js";
import {processBlobKzgCommitments} from "./processBlobKzgCommitments.js";
// Spec tests
export {processBlockHeader, processExecutionPayload, processRandao, processEth1Data, processSyncAggregate};
export * from "./processOperations.js";

export * from "./initiateValidatorExit.js";
export * from "./isValidIndexedAttestation.js";

export async function processBlock(
  fork: ForkSeq,
  state: CachedBeaconStateAllForks,
  block: allForks.FullOrBlindedBeaconBlock,
  verifySignatures = true,
  executionEngine: ExecutionEngine | null,
  retrieveBlobsSidecar: BlobsSidecarRetrievalFunction
): Promise<void> {
  console.log("State Transition processBlock is running");

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
      !(await isDataAvailable(
        retrieveBlobsSidecar,
        block.slot,
        ssz.eip4844.BeaconBlock.hashTreeRoot(block as eip4844.BeaconBlock),
        body.blobKzgCommitments
      ))
    ) {
      throw new Error("Expected blobs sidecar not found for EIP-4844 block");
    }
  }
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#is_data_available
async function isDataAvailable(
  retrieveBlobsSidecar: BlobsSidecarRetrievalFunction,
  slot: number,
  beaconBlockRoot: Root,
  blobKzgCommitments: KZGCommitment[]
): Promise<boolean> {
  const sidecar = await retrieveBlobsSidecar(beaconBlockRoot);
  if (!sidecar) {
    return false;
  }

  validateBlobsSidecar(slot, beaconBlockRoot, blobKzgCommitments, sidecar);
  return true;
}

class BlobsSidecarValidationError extends Error {
  constructor(message: string) {
    super(`Blobs sidecar validation failed: ${message}`);
  }
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#validate_blobs_sidecar
function validateBlobsSidecar(
  slot: number,
  beaconBlockRoot: Root,
  expectedKzgCommitments: KZGCommitment[],
  blobsSidecar: BlobsSidecar
): void {
  // assert slot == blobs_sidecar.beacon_block_slot
  if (slot != blobsSidecar.beaconBlockSlot) {
    throw new BlobsSidecarValidationError(
      `slot mismatch. Block slot: ${slot}, Blob slot ${blobsSidecar.beaconBlockSlot}`
    );
  }

  // assert beacon_block_root == blobs_sidecar.beacon_block_root
  if (beaconBlockRoot !== blobsSidecar.beaconBlockRoot) {
    throw new BlobsSidecarValidationError(
      `beacon block root mismatch. Block root: ${beaconBlockRoot}, Blob root ${blobsSidecar.beaconBlockRoot}`
    );
  }

  // blobs = blobs_sidecar.blobs
  // kzg_aggregated_proof = blobs_sidecar.kzg_aggregated_proof
  const {blobs, kzgAggregatedProof} = blobsSidecar;

  // assert len(expected_kzg_commitments) == len(blobs)
  if (expectedKzgCommitments.length !== blobs.length) {
    throw new BlobsSidecarValidationError(
      `blobs length to commitments length mismatch. Blob length: ${blobs.length}, Expected commitments length ${expectedKzgCommitments.length}`
    );
  }

  // assert verify_aggregate_kzg_proof(blobs, expected_kzg_commitments, kzg_aggregated_proof)
  if (!verifyAggregateKzgProof(blobs, expectedKzgCommitments, kzgAggregatedProof)) {
    throw new BlobsSidecarValidationError("aggregate KZG proof validation failed.");
  }
}
