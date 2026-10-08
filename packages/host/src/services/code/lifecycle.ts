/**
 * The code service's ties to the host lifecycle: watches, searches and the
 * symbol index end with their session, and everything ends with the host.
 */

import { addHostEventSink } from "@argus/host/bus";
import { stopCodeSearches } from "./search";
import { initSymbolIndex, stopSymbolIndex } from "./symbols";
import { initCodeWatches, stopCodeWatches } from "./watch";

let detach: (() => void) | null = null;

export function initCodeService(): void {
  initCodeWatches();
  initSymbolIndex();
  detach?.();
  detach = addHostEventSink((channel, args) => {
    if (channel === "session:deleted" && typeof args[0] === "string") {
      stopCodeSearches(args[0]);
    }
  });
}

export function stopCodeService(): void {
  detach?.();
  detach = null;
  stopCodeSearches();
  stopCodeWatches();
  stopSymbolIndex();
}
