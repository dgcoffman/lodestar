import {ValueOf} from "@chainsafe/ssz";
import * as ssz from "./sszTypes.js";

export type VersionedHash = ValueOf<typeof ssz.VersionedHash>;
export type KZGProof = ValueOf<typeof ssz.KZGProof>;
export type KZGCommitment = ValueOf<typeof ssz.KZGCommitment>;
export type Blob = ValueOf<typeof ssz.Blob>;
export type Blobs = ValueOf<typeof ssz.Blobs>;
export type BlobsSidecar = ValueOf<typeof ssz.BlobsSidecar>;
export type BlobKzgCommitments = ValueOf<typeof ssz.BlobKzgCommitments>;
export type Polynomial = ValueOf<typeof ssz.Polynomial>;
export type PolynomialAndCommitment = ValueOf<typeof ssz.PolynomialAndCommitment>;
export type BLSFieldElement = ValueOf<typeof ssz.BLSFieldElement>;

export type ExecutionPayload = ValueOf<typeof ssz.ExecutionPayload>;
export type ExecutionPayloadHeader = ValueOf<typeof ssz.ExecutionPayloadHeader>;

export type BeaconBlockBody = ValueOf<typeof ssz.BeaconBlockBody>;
export type BeaconBlock = ValueOf<typeof ssz.BeaconBlock>;
export type SignedBeaconBlock = ValueOf<typeof ssz.SignedBeaconBlock>;
export type SignedBeaconBlockAndBlobsSidecar = ValueOf<typeof ssz.SignedBeaconBlockAndBlobsSidecar>;

export type BeaconState = ValueOf<typeof ssz.BeaconState>;

export type BlindedBeaconBlockBody = ValueOf<typeof ssz.BlindedBeaconBlockBody>;
export type BlindedBeaconBlock = ValueOf<typeof ssz.BlindedBeaconBlock>;
export type SignedBlindedBeaconBlock = ValueOf<typeof ssz.SignedBlindedBeaconBlock>;

// Constants

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#blob
// TODO EIP-4844 not sure these are correct
export const BLOB_TX_TYPE = 5;
export const VERSIONED_HASH_VERSION_KZG = 1;
