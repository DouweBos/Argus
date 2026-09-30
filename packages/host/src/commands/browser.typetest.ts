import type { Equal, Expect } from "./typeEquality";
import type { BrowserPreset as HostBrowserPreset } from "../services/browser/conductorInput";
import type { BrowserPreset } from "@argus/remote-protocol";

export type BrowserModelChecks = [
  Expect<Equal<BrowserPreset, HostBrowserPreset>>,
];
