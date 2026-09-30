import type { UpdaterState as ShellUpdaterState } from "./services/updater";
import type { Equal, Expect } from "@argus/host/commands/typeEquality";
import type { UpdaterState } from "@argus/remote-protocol";

export type ShellModelChecks = [Expect<Equal<UpdaterState, ShellUpdaterState>>];
