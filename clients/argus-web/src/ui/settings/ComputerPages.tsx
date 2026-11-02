/**
 * The connected computer's settings a browser can see or change, as the
 * phone's `SettingsComputerPages`: the connection, the mode agents started
 * here begin in, the automation autonomy cap and the device hosts.
 */

import { useEffect, useState } from "react";
import { AUTONOMY_CAPTIONS, AUTONOMY_LABELS, AUTONOMY_LEVELS } from "@argus/client-core";
import {
  Banner,
  Button,
  EmptyState,
  Icons,
  ConfirmDialog,
  Select,
  SettingsGroup,
  SettingsPageColumn,
  SettingsRow,
  Spinner,
} from "@argus/peacock";
import {
  setDefaultPermissionMode,
  START_MODES,
  useDefaultPermissionMode,
} from "../../lib/agentDefaults";
import type { RemotePermissionMode } from "../../lib/protocol";
import { useConnectionStore } from "../../stores/connection";
import { useSettingsStore } from "../../stores/settings";
import { capture } from "../../telemetry/telemetry";
import { DeviceHostsSection } from "../DeviceHostsSection";
import { IntegrationsField } from "../IntegrationsField";
import { ConnectionBadge } from "../ConnectionBadge";

const MODE_LABELS: Record<RemotePermissionMode, string> = {
  auto: "Auto",
  ask: "Ask",
  plan: "Plan",
  review: "Review",
};


function grantLabel(capabilities: string[]): string {
  if (capabilities.includes("control")) {
    return "Watch and control agents";
  }

  return capabilities.includes("monitor") ? "Watch only" : "None";
}

export function ConnectionPage() {
  const connection = useConnectionStore((s) => s.connection);
  const capabilities = useConnectionStore((s) => s.capabilities);
  const account = useConnectionStore((s) => s.identity?.account);
  const unpair = useConnectionStore((s) => s.unpair);
  const [confirming, setConfirming] = useState(false);

  return (
    <SettingsPageColumn>
      <SettingsGroup
        footer={
          account
            ? `Connected to ${account.hostName} through its tunnel.`
            : "Change what this browser may do under Settings → Remote in Argus on the computer."
        }
        title={account?.hostName ?? "This computer"}
      >
        <SettingsRow
          control={
            <>
              <ConnectionBadge state={connection} />
              {connection === "ready" ? "Connected" : "Not connected"}
            </>
          }
          title="Status"
        />
        <SettingsRow control={grantLabel(capabilities)} title="Access" />
      </SettingsGroup>
      <IntegrationsField />
      <SettingsGroup>
        {account ? (
          <SettingsRow
            control={
              <Button size="sm" variant="secondary" onClick={account.leave}>
                Switch Computer
              </Button>
            }
            description="Back to your account's computers."
            title="Computer"
          />
        ) : (
          <SettingsRow
            control={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirming(true)}
              >
                Unpair…
              </Button>
            }
            description="Removes the stored key from this browser. You'll need to pair again from Argus to reconnect."
            title="Unpair this browser"
          />
        )}
      </SettingsGroup>
      {confirming && (
        <ConfirmDialog
          destructive
          confirmLabel="Unpair"
          title="Unpair this browser?"
          titleId="aw-unpair"
          onCancel={() => setConfirming(false)}
          onConfirm={unpair}
        >
          You'll need to pair again from Argus on the computer to reconnect.
        </ConfirmDialog>
      )}
    </SettingsPageColumn>
  );
}

export function AgentsPage() {
  const mode = useDefaultPermissionMode();

  return (
    <SettingsPageColumn>
      <SettingsGroup title="New agents">
        <SettingsRow
          control={
        <Select
          aria-label="Default permission mode"
          value={mode ?? ""}
          onChange={(e) => {
            const next = START_MODES.find((m) => m === e.target.value) ?? null;
            setDefaultPermissionMode(next);
            capture("web_default_changed", {
              setting: "permission_mode",
              value: next ?? "none",
            });
          }}
        >
          <option value="">Computer's default</option>
          {START_MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_LABELS[m]}
            </option>
          ))}
        </Select>
          }
          description="The mode new agents started from this browser begin in."
          title="Default permission mode"
        />
      </SettingsGroup>
    </SettingsPageColumn>
  );
}

export function AutomationsPage() {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const autonomy = useSettingsStore((s) => s.autonomy);
  const error = useSettingsStore((s) => s.autonomyError);
  const loadAutonomy = useSettingsStore((s) => s.loadAutonomy);
  const setAutonomy = useSettingsStore((s) => s.setAutonomy);

  useEffect(() => {
    if (connection === "ready") {
      loadAutonomy().catch(() => {});
    }
  }, [connection, loadAutonomy]);

  if (autonomy === undefined) {
    return error ? (
      <EmptyState
        icon={<Icons.WarningIcon size={18} />}
        title="Couldn't read the computer's settings"
        body={error}
      />
    ) : (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Reading the computer's settings…</span>
      </div>
    );
  }

  return (
    <SettingsPageColumn>
      <SettingsGroup title="Automations">
        <SettingsRow
          control={
        <Select
          aria-label="Autonomy cap"
          disabled={!hasControl}
          value={autonomy ?? ""}
          onChange={(e) => {
            const next = AUTONOMY_LEVELS.find((r) => r === e.target.value) ?? null;
            setAutonomy(next)
              .then((ok) => {
                if (ok) {
                  capture("web_default_changed", {
                    setting: "autonomy",
                    value: next ?? "none",
                  });
                }
              })
              .catch(() => {});
          }}
        >
          <option value="">No cap</option>
          {AUTONOMY_LEVELS.map((r) => (
            <option key={r} value={r}>
              {AUTONOMY_LABELS[r]}
            </option>
          ))}
        </Select>
          }
          description={`${autonomy ? `${AUTONOMY_CAPTIONS[autonomy]} ` : ""}How far any automation on this computer may go on its own. A project can cap it lower, never higher.`}
          title="Autonomy cap"
        />
      </SettingsGroup>
      {error && <Banner tone="error">{error}</Banner>}
    </SettingsPageColumn>
  );
}


/** The computer's device hosts; an EAS host can start a billed session from here. */
export function DeviceHostsPage() {
  return (
    <SettingsPageColumn>
      <DeviceHostsSection />
    </SettingsPageColumn>
  );
}
