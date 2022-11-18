import {eip4844} from "@lodestar/types";
import {
  BlobKzgCommitments,
  BLOB_TX_TYPE,
  KZGCommitment,
  VersionedHash,
  VERSIONED_HASH_VERSION_KZG,
} from "@lodestar/types/eip4844";
import {Transaction} from "@lodestar/types/bellatrix";
import {digest} from "@chainsafe/as-sha256";
import {typedArraysAreEqual} from "../util/array.js";

/**
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#blob-kzg-commitments
 *
 * def process_blob_kzg_commitments(state: BeaconState, body: BeaconBlockBody):
 *   assert verify_kzg_commitments_against_transactions(
 *     body.execution_payload.transactions,
 *     body.blob_kzg_commitments
 *   )
 */
export function processBlobKzgCommitments({executionPayload, blobKzgCommitments}: eip4844.BeaconBlockBody): void {
  if (!verifyKzgCommitmentsAgainstTransactions(executionPayload.transactions, blobKzgCommitments)) {
    throw new Error("Invalid versioned hashes for blob transaction");
  }
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#verify_kzg_commitments_against_transactions
// def verify_kzg_commitments_against_transactions(
//  transactions: Sequence[Transaction],
//  kzg_commitments: Sequence [KZGCommitment],
// ) -> bool:
//     all_versioned_hashes = []
//     for tx in transactions:
//         if tx[0] == BLOB_TX_TYPE:
//             all_versioned_hashes += tx_peek_blob_versioned_hashes(tx)
//     return all_versioned_hashes == [kzg_commitment_to_versioned_hash(commitment) for commitment in kzg_commitments]
export function verifyKzgCommitmentsAgainstTransactions(
  transactions: Transaction[],
  kzgCommitments: BlobKzgCommitments
): boolean {
  const allVersionedHashes: VersionedHash[] = [];
  transactions.forEach((tx) => {
    if (tx[0] === BLOB_TX_TYPE) {
      allVersionedHashes.push(...txPeekBlobVersionedHashes(tx));
    }
  });
  return allVersionedHashes.every((hash, index) =>
    typedArraysAreEqual(hash, kzgCommitmentToVersionedHash(kzgCommitments[index]))
  );
}

/**
 * This function retrieves the hashes from the SignedBlobTransaction as defined in EIP-4844, using SSZ offsets.
 * Offsets are little-endian uint32 values, as defined in the SSZ specification.
 * See the full details of blob_versioned_hashes offset calculation.
 *
 * @param opaqueTx
 *
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#tx_peek_blob_versioned_hashes
 */
//  def tx_peek_blob_versioned_hashes(opaque_tx: Transaction) -> Sequence[VersionedHash]:
//     assert opaque_tx[0] == BLOB_TX_TYPE
//     message_offset = 1 + uint32.decode_bytes(opaque_tx[1:5])
//     # field offset: 32 + 8 + 32 + 32 + 8 + 4 + 32 + 4 + 4 + 32 = 188
//     blob_versioned_hashes_offset = (
//         message_offset
//         + uint32.decode_bytes(opaque_tx[(message_offset + 188):(message_offset + 192)])
//     )
//     return [
//         VersionedHash(opaque_tx[x:(x + 32)])
//         for x in range(blob_versioned_hashes_offset, len(opaque_tx), 32)
//     ]
// Format of the blob tx relevant to this function is as follows:
//   0: type (value should always be BlobTxType, 1 byte)
//   1: message offset (value should always be 69, 4 bytes)
//   5: ECDSA signature (65 bytes)
//   70: start of "message" (192 bytes)
//     258: start of the versioned hash offset within "message"  (4 bytes)
//   262-: rest of the tx following message
function txPeekBlobVersionedHashes(opaqueTx: Transaction): VersionedHash[] {
  if (opaqueTx[0] !== BLOB_TX_TYPE) {
    throw new Error("txPeekBlobVersionedHashes must be called on blob-carrying transactions only.");
  }

  // message_offset = 1 + uint32.decode_bytes(opaque_tx[1:5])
  const messageOffset = 1 + new DataView(opaqueTx.slice(1, 5).buffer, 0).getUint32(0, true); // Should always be 70

  // field offset: 32 + 8 + 32 + 32 + 8 + 4 + 32 + 4 + 4 + 32 = 188
  // 70 + 188 = 258, the start of the versioned hash offset
  // We expect this to always be: 283
  const blobVersionedHashOffset =
    messageOffset + new DataView(opaqueTx.slice(messageOffset + 188, messageOffset + 192).buffer, 0).getUint32(0, true);

  const versionedHashes: VersionedHash[] = [];
  for (let x = blobVersionedHashOffset; x < opaqueTx.length; x += 32) {
    const hash = opaqueTx.slice(x, x + 32);
    versionedHashes.push(hash);
  }
  return versionedHashes;
}

/**
 * def kzg_commitment_to_versioned_hash(kzg_commitment: KZGCommitment) -> VersionedHash:
 *   return VERSIONED_HASH_VERSION_KZG + hash(kzg_commitment)[1:]
 *
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#kzg_commitment_to_versioned_hash
 */
function kzgCommitmentToVersionedHash(kzgCommitment: KZGCommitment): VersionedHash {
  const hash = digest(kzgCommitment);
  hash[0] = VERSIONED_HASH_VERSION_KZG;
  return hash;
}
