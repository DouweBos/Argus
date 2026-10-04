import type { Equal, Expect } from "./typeEquality";
import type { PathKind as HostPathKind } from "../services/file/bytes";
import type {
  GitRunnerInfo as HostInfo,
  GitRunnerOutputChunk as HostOutputChunk,
  GitRunnerRunResult as HostRunResult,
} from "../services/gitRunner/runner";
import type {
  GitRunnerInfo,
  GitRunnerOutputChunk,
  GitRunnerRunResult,
  PathKind,
} from "@argus/remote-protocol";

export type GitRunnerModelChecks = [
  Expect<Equal<GitRunnerInfo, HostInfo>>,
  Expect<Equal<GitRunnerRunResult, HostRunResult>>,
  Expect<Equal<GitRunnerOutputChunk, HostOutputChunk>>,
  Expect<Equal<PathKind, HostPathKind>>,
];
