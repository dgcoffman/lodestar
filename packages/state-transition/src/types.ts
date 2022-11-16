import {Root} from "@lodestar/types";
import {BlobsSidecar} from "@lodestar/types/eip4844";

export {EpochContext} from "./cache/epochContext.js";
export {EpochProcess} from "./cache/epochProcess.js";

export {
  CachedBeaconStatePhase0,
  CachedBeaconStateAltair,
  CachedBeaconStateBellatrix,
  CachedBeaconStateAllForks,
  CachedBeaconStateCapella,
  CachedBeaconStateExecutions,
  CachedBeaconState4844,
} from "./cache/stateCache.js";

export {
  BeaconStatePhase0,
  BeaconStateAltair,
  BeaconStateBellatrix,
  BeaconStateCapella,
  BeaconStateAllForks,
  BeaconStateExecutions,
} from "./cache/types.js";

export type BlobsSidecarRetrievalFunction = (beaconBlockRoot: Root) => Promise<BlobsSidecar | null>;
