import type { Equal, Expect } from "./typeEquality";
import type {
  RunTerminalResult as HostRunTerminalResult,
  TerminalSummary as HostTerminalSummary,
} from "../services/terminal/multiplexer";
import type {
  RunTerminalResult,
  TerminalSummary,
} from "@argus/remote-protocol";

export type TerminalModelChecks = [
  Expect<Equal<TerminalSummary, HostTerminalSummary>>,
  Expect<Equal<RunTerminalResult, HostRunTerminalResult>>,
];
