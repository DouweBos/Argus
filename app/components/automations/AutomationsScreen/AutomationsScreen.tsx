import type { Automation } from "../../../lib/types";
import { useState } from "react";
import {
  AutomationRow,
  Button,
  EmptyState,
  Icons,
  Spinner,
} from "@argus/peacock";
import {
  formatRelative,
  localTimezone,
  nextRunLabel,
  triggerLabel,
} from "../../../lib/automations";
import {
  createAutomation,
  openAutomation,
  setAutomationEnabled,
  useAutomations,
  useAutomationsError,
  useAutomationsLoading,
  useHasActiveRun,
  useLatestRun,
} from "../../../stores/automationStore";
import { DescribeAutomationDialog } from "../DescribeAutomationDialog/DescribeAutomationDialog";
import {
  CancelRunButton,
  RunStatusBadge,
  TriggerRunButton,
} from "../RunControls";
import styles from "./AutomationsScreen.module.css";

const NEW_PLAYBOOK = `# New automation

Describe what this run should do, in markdown. The agent reads the projects in
scope at their absolute paths and writes its findings as its final message.
`;

function Row({ automation }: { automation: Automation }) {
  const latest = useLatestRun(automation.id);
  const active = useHasActiveRun(automation.id);

  return (
    <AutomationRow
      name={automation.name}
      description={automation.description || undefined}
      trigger={triggerLabel(automation.trigger)}
      enabled={automation.enabled}
      onToggleEnabled={(enabled) => {
        setAutomationEnabled(automation.id, enabled).catch(() => undefined);
      }}
      onOpen={() => openAutomation(automation.id)}
      lastRunStatus={latest ? <RunStatusBadge status={latest.status} /> : null}
      lastRunLabel={latest ? formatRelative(latest.started_at) : "Never"}
      nextRunLabel={nextRunLabel(automation)}
      actions={
        active && latest ? (
          <CancelRunButton runId={latest.id} />
        ) : (
          <TriggerRunButton automationId={automation.id} />
        )
      }
    />
  );
}

/** `/automations` — every automation on the focused host. */
export function AutomationsScreen() {
  const automations = useAutomations();
  const loading = useAutomationsLoading();
  const error = useAutomationsError();
  const [creating, setCreating] = useState(false);
  const [describing, setDescribing] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const automation = await createAutomation({
        name: "New automation",
        description: "",
        playbook: NEW_PLAYBOOK,
        enabled: false,
        trigger: {
          kind: "schedule",
          cron: "0 9 * * 1-5",
          timezone: localTimezone(),
          catch_up: true,
        },
      });
      openAutomation(automation.id);
    } catch {
      // Creation only fails on a disconnected host; the banner covers it.
    } finally {
      setCreating(false);
    }
  };

  const startCreate = () => {
    create().catch(() => undefined);
  };

  let body = (
    <div className={styles.list}>
      {automations.map((automation) => (
        <Row key={automation.id} automation={automation} />
      ))}
    </div>
  );
  if (automations.length === 0) {
    body = loading ? (
      <div className={styles.loading}>
        <Spinner />
      </div>
    ) : (
      <EmptyState
        icon={<Icons.ClockIcon size={18} />}
        title="No automations yet"
        body="An automation is a playbook plus a clock: it wakes an agent up on a schedule, or when you press Run."
        action={
          <Button size="sm" onClick={() => setDescribing(true)}>
            Describe it
          </Button>
        }
      />
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.titleHeading}>Automations</h1>
        <span className={styles.sub}>
          {automations.length} automation{automations.length === 1 ? "" : "s"}
        </span>
        <span className={styles.spacer} />
        <Button
          size="sm"
          variant="secondary"
          leading={<Icons.SparklesIcon size={11} />}
          onClick={() => setDescribing(true)}
        >
          Describe it
        </Button>
        <Button
          size="sm"
          leading={<Icons.PlusIcon size={11} />}
          disabled={creating}
          onClick={startCreate}
        >
          New automation
        </Button>
      </header>

      {error && <p className={styles.error}>{error}</p>}

      {body}

      {describing && (
        <DescribeAutomationDialog onClose={() => setDescribing(false)} />
      )}
    </div>
  );
}
