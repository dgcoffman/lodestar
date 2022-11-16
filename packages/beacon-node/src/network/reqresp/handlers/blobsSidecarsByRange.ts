import {GENESIS_SLOT} from "@lodestar/params";
import {eip4844} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {RespStatus} from "../../../constants/index.js";
import {ResponseError} from "../response/index.js";

export async function* onBlobsSidecarsByRange(
  requestBody: eip4844.BlobsSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<Uint8Array> {
  const {startSlot} = requestBody;
  const {count} = requestBody;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  const lt = startSlot + count;

  yield* getBlobsSidecarsByRange(startSlot, lt, db);
}

async function* getBlobsSidecarsByRange(gte: number, lt: number, db: IBeaconDb): AsyncIterable<Uint8Array> {
  const binaryEntriesStream = db.blob.binaryValuesStreamBySlot({
    gte,
    lt,
  });
  for await (const value of binaryEntriesStream) {
    yield value;
  }
}
