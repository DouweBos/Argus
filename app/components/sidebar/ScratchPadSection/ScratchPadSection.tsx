import type { Session } from "../../../lib/types";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Icons, SidebarRepoAction, SidebarSection } from "@argus/peacock";
import {
  createScratchPadSession,
  deleteSessionById,
} from "../../../lib/projectsService";
import { useRouteHostId } from "../../../lib/routeHooks";
import { isLocalHost } from "../../../lib/transport/hostId";
import {
  selectSession,
  sessionHostId,
  useSelectedSessionId,
  useSessions,
} from "../../../stores/sessionStore";
import { RenameSessionDialog } from "../RenameSessionDialog";
import { SessionCard } from "../SessionCard";
import { DeleteScratchPadDialog } from "./DeleteScratchPadDialog";
import styles from "./ScratchPadSection.module.css";

/** Agents that belong to no project, each in its own directory. */
export function ScratchPadSection() {
  const sessions = useSessions();
  const selectedId = useSelectedSessionId();
  const routeHostId = useRouteHostId();
  const [isCreating, setIsCreating] = useState(false);
  const [padToDelete, setPadToDelete] = useState<Session | null>(null);
  const [padToRename, setPadToRename] = useState<Session | null>(null);

  // Same host rule as projects: this Mac's tab shows every host's pads.
  const pads = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.kind === "scratch_pad" &&
          (isLocalHost(routeHostId) || sessionHostId(s.id) === routeHostId),
      ),
    [sessions, routeHostId],
  );

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      await createScratchPadSession(routeHostId);
    } catch {
      // Surfaced by the service.
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <SidebarSection
        count={pads.length}
        action={
          <SidebarRepoAction
            title="New scratch pad"
            disabled={isCreating}
            onClick={handleCreate}
          >
            <Icons.PlusIcon size={10} />
          </SidebarRepoAction>
        }
      >
        Scratch pads
      </SidebarSection>
      {pads.length > 0 && (
        <div aria-label="Scratch pads" className={styles.list} role="listbox">
          {pads.map((pad) => (
            <SessionCard
              key={pad.id}
              isSelected={pad.id === selectedId}
              session={pad}
              onDelete={async () => setPadToDelete(pad)}
              onRename={() => setPadToRename(pad)}
              onSelect={() => selectSession(pad.id)}
            />
          ))}
        </div>
      )}

      {padToDelete &&
        createPortal(
          <DeleteScratchPadDialog
            pad={padToDelete}
            onClose={() => setPadToDelete(null)}
            onConfirm={() => deleteSessionById(padToDelete.id)}
          />,
          document.body,
        )}

      {padToRename &&
        createPortal(
          <RenameSessionDialog
            session={padToRename}
            onClose={() => setPadToRename(null)}
          />,
          document.body,
        )}
    </>
  );
}
