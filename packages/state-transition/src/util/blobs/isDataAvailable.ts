import {KZGCommitment, verifyAggregateKzgProof} from "c-kzg";
import {Root} from "@lodestar/types";
import {BlobsSidecar} from "@lodestar/types/eip4844";
import {typedArraysAreEqual} from "../array.js";

/**
 *
 * The implementation of is_data_available is meant to change with later sharding
 * upgrades. Initially, it requires every verifying actor to retrieve the
 * matching BlobsSidecar, and validate the sidecar with validate_blobs_sidecar.
 *
 * Without the sidecar the block may be processed further optimistically, but
 * MUST NOT be considered valid until a valid BlobsSidecar has been downloaded.
 *
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#is_data_available
 *
 * @param retrieveBlobsSidecar
 * @param slot
 * @param beaconBlockRoot
 * @param blobKzgCommitments
 * @returns
 */
export function isDataAvailable(
  sidecar: BlobsSidecar | undefined,
  slot: number,
  beaconBlockRoot: Root,
  blobKzgCommitments: KZGCommitment[]
): boolean {
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
  if (!typedArraysAreEqual(beaconBlockRoot, blobsSidecar.beaconBlockRoot)) {
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

  // No need to verify the aggregate proof of zero blobs. Also c-kzg throws.
  // https://github.com/dankrad/c-kzg/pull/12/files#r1025851956
  if (blobs.length) {
    // assert verify_aggregate_kzg_proof(blobs, expected_kzg_commitments, kzg_aggregated_proof)
    verifyAggregateKzgProof(blobs, expectedKzgCommitments, kzgAggregatedProof);
  }
}
