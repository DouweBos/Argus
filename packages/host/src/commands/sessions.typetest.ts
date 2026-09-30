import type { Equal, Expect } from "./typeEquality";
import type { AgentInfo as HostAgentInfo } from "../services/agent/models";
import type { ProjectEntry as HostProjectEntry } from "../services/mcp/projectDiscovery";
import type { HostSnapshot as HostHostSnapshot } from "../services/session/hostState";
import type {
  ForkReplayOp as HostForkReplayOp,
  ForkSessionResult as HostForkSessionResult,
} from "../services/session/manager";
import type {
  Session as HostSession,
  SessionKind as HostSessionKind,
  SessionStatus as HostSessionStatus,
} from "../services/session/models";
import type {
  AgentInfo,
  ForkReplayOp,
  ForkSessionResult,
  HostSnapshot,
  ProjectEntry,
  Session,
  SessionKind,
  SessionStatus,
} from "@argus/remote-protocol";

export type SessionModelChecks = [
  Expect<Equal<SessionKind, HostSessionKind>>,
  Expect<Equal<SessionStatus, HostSessionStatus>>,
  Expect<Equal<Session, HostSession>>,
  Expect<Equal<ProjectEntry, HostProjectEntry>>,
  Expect<Equal<AgentInfo, HostAgentInfo>>,
  Expect<Equal<HostSnapshot, HostHostSnapshot>>,
  Expect<Equal<ForkReplayOp, HostForkReplayOp>>,
  Expect<Equal<ForkSessionResult, HostForkSessionResult>>,
];
