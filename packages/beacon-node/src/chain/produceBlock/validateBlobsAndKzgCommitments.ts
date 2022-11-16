import {blobToKzgCommitment} from "c-kzg";
import {eip4844} from "@lodestar/types";

import {Blob, KZGCommitment} from "@lodestar/types/eip4844";
import {verifyKzgCommitmentsAgainstTransactions} from "@lodestar/state-transition/block";

/**
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#blob-kzg-commitments
 *
 * @param executionPayload
 * @param blobs
 * @param blobKzgCommitments
 * @returns Throws if the data is invalid
 */
export function validateBlobsAndKzgCommitments(
  executionPayload: eip4844.ExecutionPayload,
  blobs: Blob[],
  blobKzgCommitments: KZGCommitment[]
): void {
  // assert len(blob_kzg_commitments) == len(blobs)
  if (blobKzgCommitments.length !== blobs.length) {
    throw new Error(
      `Error validating execution payload during block construction: Blobs length of ${blobs.length} did not match KZG commitments lenght of ${blobKzgCommitments.length}`
    );
  }

  // assert [blob_to_kzg_commitment(blob) == commitment for blob, commitment in zip(blobs, blob_kzg_commitments)]
  blobs.forEach((blob, index) => {
    if (blobToKzgCommitment(blob) !== blobKzgCommitments[index]) {
      throw new Error(
        `Error validating execution payload during block construction: KZG commitment supplied by execution client does not match that computed by Lodestar, at index ${index}`
      );
    }
  });

  // assert verify_kzg_commitments_against_transactions(execution_payload.transactions, blob_kzg_commitments)
  if (!verifyKzgCommitmentsAgainstTransactions(executionPayload.transactions, blobKzgCommitments)) {
    throw new Error(
      "Error validating execution payload during block construction: Invalid versioned hashes for blob transaction"
    );
  }
}
