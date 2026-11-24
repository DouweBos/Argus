/** `/teammates/:id/memory`: one memory every duty and conversation reads and writes. */

import { useEffect, useState } from "react";
import { describeError } from "@argus/client-core";
import { AutomationMemories, TeammatePageBar } from "@argus/peacock";
import { useConnectionStore } from "../../stores/connection";
import { useTeammatesStore } from "../../stores/teammates";
import { showTeammatePage } from "./teammateNav";

export function TeammateMemory({ teammateId }: { teammateId: string }) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const memories = useTeammatesStore((s) => s.memoriesById[teammateId]);
  const [error, setError] = useState<string | null>(null);
  const store = useTeammatesStore.getState;

  useEffect(() => {
    if (ready) {
      store()
        .loadMemories(teammateId)
        .catch((err: unknown) => setError(describeError(err)));
    }
  }, [ready, teammateId, store]);

  return (
    <div className="aw-automations">
      <TeammatePageBar
        page="memory"
        onPage={(page) => showTeammatePage(teammateId, page)}
      />
      <AutomationMemories
        emptyText="Nothing yet. Tell it to remember something, or let its duties save what they learn."
        error={error}
        footer="Plain markdown files on this computer; up to 100."
        memories={memories ?? null}
        onDelete={
          hasControl
            ? (name) => void store().deleteMemory(teammateId, name)
            : undefined
        }
        onSave={
          hasControl
            ? (memory) => store().saveMemory(teammateId, memory)
            : undefined
        }
      />
    </div>
  );
}
