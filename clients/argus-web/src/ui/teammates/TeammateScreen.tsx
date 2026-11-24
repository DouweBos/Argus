/**
 * `/teammates/:teammateId[/…]`: one teammate. Its conversation by default;
 * the profile, duties and memory are routes of their own.
 */

import type { TeammatePage } from "@argus/client-core";
import { useEffect, useState } from "react";
import { Button, EmptyState, Icons, Spinner } from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { useTeammatesStore } from "../../stores/teammates";
import { TeammateConversation } from "./TeammateConversation";
import { TeammateDuties } from "./TeammateDuties";
import { TeammateMemory } from "./TeammateMemory";
import { TeammateProfile } from "./TeammateProfile";

export function TeammateScreen({
  page,
  teammateId,
  threadId,
}: {
  teammateId: string;
  page: TeammatePage;
  threadId: string | null;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const known = useTeammatesStore((s) =>
    s.summaries.some((t) => t.teammate.id === teammateId),
  );
  const detail = useTeammatesStore((s) => s.detailById[teammateId]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!ready) {
      return;
    }
    setMissing(false);
    void useTeammatesStore
      .getState()
      .refresh({ background: true })
      .catch(() => {});
    useTeammatesStore
      .getState()
      .loadDetail(teammateId)
      .catch(() => setMissing(true));
  }, [ready, teammateId]);

  if (missing && !known) {
    return (
      <EmptyState
        action={
          <Button size="sm" onClick={() => appNavigate({ name: "teammates" })}>
            Back to teammates
          </Button>
        }
        body="It may have been deleted on this computer."
        icon={<Icons.PersonIcon size={18} />}
        title="Teammate not found"
      />
    );
  }
  if (!detail && !known) {
    return (
      <div className="aw-center">
        <Spinner />
      </div>
    );
  }

  switch (page) {
    case "chat":
      return <TeammateConversation teammateId={teammateId} threadId={threadId} />;
    case "profile":
      return <TeammateProfile key={teammateId} teammateId={teammateId} />;
    case "duties":
      return <TeammateDuties teammateId={teammateId} />;
    case "memory":
      return <TeammateMemory teammateId={teammateId} />;
  }
}
