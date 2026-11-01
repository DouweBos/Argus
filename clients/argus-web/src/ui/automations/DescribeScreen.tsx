/**
 * `/automations/describe`: a sentence in, a draft automation out, reviewed
 * right underneath, saved paused. Drafting spends the computer's Claude
 * account, so it needs control.
 */

import { DescribeAutomationView, EmptyState, Icons } from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useAutomationsStore } from "../../stores/automations";
import { useConnectionStore } from "../../stores/connection";

export function DescribeScreen() {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const store = useAutomationsStore.getState;

  if (!hasControl) {
    return (
      <EmptyState
        body="Drafting an automation spends this computer's Claude account, so it needs control. Pair again with control to describe one."
        icon={<Icons.SparklesIcon size={18} />}
        title="Needs control"
      />
    );
  }

  return (
    <div className="aw-automations">
      <DescribeAutomationView
        onCreate={async (draft) => {
          const id = await store().save(null, draft);
          // Replace the describe step: Back from the new automation is the list.
          appNavigate({ name: "automation", automationId: id }, { replace: true });
        }}
        onDraft={(description, regenerating) =>
          store().draft(description, regenerating)
        }
      />
    </div>
  );
}
