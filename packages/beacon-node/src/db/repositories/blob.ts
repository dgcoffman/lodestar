import {IChainForkConfig} from "@lodestar/config";
import {Bucket, Db, Repository} from "@lodestar/db";
import {eip4844, ssz} from "@lodestar/types";

/**
 * BlobsSidecars by their associated beacon block root
 */
export class BlobsSidecarRepository extends Repository<Uint8Array, eip4844.BlobsSidecar> {
  constructor(config: IChainForkConfig, db: Db) {
    super(config, db, Bucket.eip4844_blobs, ssz.eip4844.BlobsSidecar);
  }

  /**
   * Id is hashTreeRoot of the associated BeaconBlock
   */
  getId(value: eip4844.BlobsSidecar): Uint8Array {
    return value.beaconBlockRoot;
  }

  encodeValue(value: eip4844.BlobsSidecar): Buffer {
    return ssz.eip4844.BlobsSidecar.serialize(value) as Buffer;
  }

  decodeValue(data: Buffer): eip4844.BlobsSidecar {
    return ssz.eip4844.BlobsSidecar.deserialize(data);
  }
}
