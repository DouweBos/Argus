import type { Equal, Expect } from "./typeEquality";
import type { BrowserPreset as HostBrowserPreset } from "../services/browser/conductorInput";
import type { BrowserDevtools as HostBrowserDevtools } from "../services/browser/devtools";
import type { BrowserDevtools, BrowserPreset } from "@argus/remote-protocol";

export type BrowserModelChecks = [
  Expect<Equal<BrowserPreset, HostBrowserPreset>>,
  Expect<Equal<BrowserDevtools, HostBrowserDevtools>>,
];
