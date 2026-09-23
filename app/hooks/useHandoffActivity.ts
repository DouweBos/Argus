import { useEffect } from "react";
import { publishHandoff } from "../lib/ipc";
import { useCurrentRoute } from "../lib/routeHooks";
import { LOCAL_HOST_ID } from "../lib/transport/hostId";
import { useActiveAgentIds } from "../stores/agentStore";
import { useSessions } from "../stores/sessionStore";

/**
 * Advertises the session on screen over Handoff, so the paired phone offers to
 * pick it up where this Mac left off.
 *
 * Only local sessions: a screen reading from another attached host describes
 * work that lives on *that* machine, and the phone would resolve the id
 * against the wrong computer. Nothing is withdrawn when the window loses
 * focus — switching away from Argus is exactly when the handoff is wanted.
 */
export function useHandoffActivity(): void {
  const { hostId, sessionId, view } = useCurrentRoute();
  const sessions = useSessions();
  const activeAgentIds = useActiveAgentIds();

  const local = hostId === LOCAL_HOST_ID;
  const session =
    view === "session" && local && sessionId
      ? sessions.find((s) => s.id === sessionId)
      : undefined;
  const agentId = session
    ? (activeAgentIds[session.id] ?? undefined)
    : undefined;
  const id = session?.id ?? null;
  const label = session ? (session.display_name ?? session.branch) : undefined;
  const repoRoot = session?.repo_root;

  useEffect(() => {
    publishHandoff(
      id
        ? {
            agentId,
            label,
            projectName: repoRoot?.split("/").pop(),
            repoRoot,
            sessionId: id,
          }
        : { sessionId: null },
    ).catch(() => undefined);
  }, [agentId, id, label, repoRoot]);
}
