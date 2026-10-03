import type { Equal, Expect } from "./typeEquality";
import type {
  RunTerminalResult as HostRunTerminalResult,
  TerminalScrollback as HostTerminalScrollback,
  TerminalSummary as HostTerminalSummary,
} from "../services/terminal/multiplexer";
import type {
  RunTerminalResult,
  TerminalScrollback,
  TerminalSummary,
} from "@argus/remote-protocol";

export type TerminalModelChecks = [
  Expect<Equal<TerminalSummary, HostTerminalSummary>>,
  Expect<Equal<RunTerminalResult, HostRunTerminalResult>>,
  Expect<Equal<TerminalScrollback, HostTerminalScrollback>>,
];
