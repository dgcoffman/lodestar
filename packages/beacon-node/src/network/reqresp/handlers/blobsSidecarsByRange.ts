import {GENESIS_SLOT} from "@lodestar/params";
import {eip4844, Root, Slot} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../chain/index.js";
import {IBeaconDb} from "../../../db/index.js";
import {RespStatus} from "../../../constants/index.js";
import {ResponseError} from "../response/index.js";

export async function* onBlobsSidecarsByRange(
  requestBody: eip4844.BlobsSidecarsByRangeRequest,
  chain: IBeaconChain,
  db: IBeaconDb
): AsyncIterable<Uint8Array[]> {
  const {startSlot} = requestBody;
  const {count} = requestBody;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  const upperSlot = startSlot + count;

  let slot = startSlot;
  const slots = [] as number[];
  while (slot < upperSlot) {
    slots.push(slot);
    slot += 1;
  }
  const roots = getBlockRootsAtSlots(slots, chain);
  const blobsSidecars = (await db.blobsSidecar.getManyBinary(roots)) ?? [];

  yield blobsSidecars;
}

function getBlockRootsAtSlots(slots: Slot[], chain: IBeaconChain): Root[] {
  if (slots.length === 0) {
    return [];
  }

  const slotsSet = new Set(slots);
  const minSlot = Math.min(...slots); // Slots must have length > 0
  const blockRootsPerSlot = new Map<Slot, Uint8Array>();

  // these blocks are on the same chain to head
  for (const block of chain.forkChoice.iterateAncestorBlocks(chain.forkChoice.getHeadRoot())) {
    if (block.slot < minSlot) {
      break;
    } else if (slotsSet.has(block.slot)) {
      blockRootsPerSlot.set(block.slot, fromHexString(block.blockRoot));
    }
  }
  return Array.from(blockRootsPerSlot.values());
}
