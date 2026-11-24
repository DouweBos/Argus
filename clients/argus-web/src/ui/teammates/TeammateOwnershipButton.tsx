/**
 * On an automation: the teammate it is a duty of, or a menu to make it one.
 * Moving it moves its memories into the teammate's.
 */

import type { RemoteAutomation } from "@argus/remote-protocol";
import { useEffect, useRef, useState } from "react";
import { Button, Icons, OptionMenu } from "@argus/peacock";
import { useConnectionStore } from "../../stores/connection";
import { useTeammatesStore } from "../../stores/teammates";
import { showTeammatePage } from "./teammateNav";

const NEW_TEAMMATE = "+new";

export function TeammateOwnershipButton({
  automation,
}: {
  automation: Pick<RemoteAutomation, "id" | "teammate_id">;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const summaries = useTeammatesStore((s) => s.summaries);
  const loaded = useTeammatesStore((s) => s.load.loaded);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ready && !loaded) {
      void useTeammatesStore
        .getState()
        .refresh({ background: true })
        .catch(() => {});
    }
  }, [ready, loaded]);

  const ownerId = automation.teammate_id;
  if (ownerId) {
    const owner = summaries.find((t) => t.teammate.id === ownerId)?.teammate;

    return (
      <Button
        leading={<Icons.PersonIcon size={12} />}
        size="sm"
        title="This automation is a duty of this teammate"
        variant="ghost"
        onClick={() => showTeammatePage(ownerId, "duties")}
      >
        {owner?.name ?? "Teammate"}
      </Button>
    );
  }
  if (!hasControl) {
    return null;
  }

  const move = async (value: string) => {
    const teammate = await useTeammatesStore
      .getState()
      .promote(automation.id, value === NEW_TEAMMATE ? null : value);
    if (teammate) {
      showTeammatePage(teammate.id, "duties");
    }
  };

  return (
    <>
      <span ref={trigger}>
        <Button
          size="sm"
          title="Make this a duty of a teammate; its memories go with it"
          variant="ghost"
          onClick={() => setOpen((o) => !o)}
        >
          Move to teammate
        </Button>
      </span>
      {open && (
        <OptionMenu
          items={[
            { value: NEW_TEAMMATE, label: "New teammate" },
            ...summaries.map((t) => ({
              value: t.teammate.id,
              label: t.teammate.name,
            })),
          ]}
          placeholder="Move to teammate"
          triggerRef={trigger}
          onClose={() => setOpen(false)}
          onSelect={(value) => void move(value)}
        />
      )}
    </>
  );
}
