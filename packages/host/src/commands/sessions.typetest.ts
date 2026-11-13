import type { Equal, Expect } from "./typeEquality";
import type { ProjectEntry as HostProjectEntry } from "../services/mcp/projectDiscovery";
import type { HostSnapshot as HostHostSnapshot } from "../services/session/hostState";
import type {
  ForkReplayOp as HostForkReplayOp,
  ForkSessionResult as HostForkSessionResult,
} from "../services/session/manager";
import type {
  Session as HostSession,
  SessionPullRequest as HostSessionPullRequest,
  SessionKind as HostSessionKind,
  SessionStatus as HostSessionStatus,
} from "../services/session/models";
import type { RestackResult as HostRestackResult } from "../services/session/stack";
import type { LandStackResult as HostLandStackResult } from "../services/session/stackLand";
import type {
  ForkReplayOp,
  ForkSessionResult,
  HostSnapshot,
  LandStackResult,
  ProjectEntry,
  RestackResult,
  Session,
  SessionKind,
  SessionPullRequest,
  SessionStatus,
} from "@argus/remote-protocol";

export type SessionModelChecks = [
  Expect<Equal<SessionKind, HostSessionKind>>,
  Expect<Equal<SessionStatus, HostSessionStatus>>,
  Expect<Equal<Session, HostSession>>,
  Expect<Equal<RestackResult, HostRestackResult>>,
  Expect<Equal<LandStackResult, HostLandStackResult>>,
  Expect<Equal<SessionPullRequest, HostSessionPullRequest>>,
  Expect<Equal<ProjectEntry, HostProjectEntry>>,
  Expect<Equal<HostSnapshot, HostHostSnapshot>>,
  Expect<Equal<ForkReplayOp, HostForkReplayOp>>,
  Expect<Equal<ForkSessionResult, HostForkSessionResult>>,
];
