/**
 * The connected computer's settings a browser can see or change, as the
 * phone's `SettingsComputerPages`: the connection, the mode agents started
 * here begin in, the automation autonomy cap and the device hosts.
 */

import { useEffect } from "react";
import { AUTONOMY_CAPTIONS, AUTONOMY_LABELS, AUTONOMY_LEVELS } from "@argus/client-core";
import {
  Banner,
  Button,
  EmptyState,
  Icons,
  Select,
  SettingsScreenField,
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

  return (
    <div className="aw-settings">
      <SettingsScreenField
        label="Status"
        caption={
          account
            ? `Connected to ${account.hostName} through its tunnel.`
            : "Change what this browser may do under Settings → Remote in Argus on the computer."
        }
      >
        <div className="aw-settings-inline">
          <ConnectionBadge state={connection} />
          <span className="aw-muted">
            {connection === "ready" ? "Connected" : "Not connected"}
          </span>
        </div>
      </SettingsScreenField>
      <SettingsScreenField label="Access">
        <span className="aw-muted">{grantLabel(capabilities)}</span>
      </SettingsScreenField>
      <IntegrationsField />
      {account ? (
        <SettingsScreenField label="Computer">
          <Button variant="secondary" onClick={account.leave}>
            Switch computer
          </Button>
        </SettingsScreenField>
      ) : (
        <SettingsScreenField
          label="Unpair this browser"
          caption="Removes the stored key from this browser. You'll need to pair again from Argus to reconnect."
        >
          <Button variant="danger" onClick={unpair}>
            Unpair
          </Button>
        </SettingsScreenField>
      )}
    </div>
  );
}

export function AgentsPage() {
  const mode = useDefaultPermissionMode();

  return (
    <div className="aw-settings">
      <SettingsScreenField
        label="Default permission mode"
        caption="The mode new agents started from this browser begin in."
      >
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
      </SettingsScreenField>
    </div>
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
    <div className="aw-settings">
      <SettingsScreenField
        label="Autonomy cap"
        caption={`${autonomy ? `${AUTONOMY_CAPTIONS[autonomy]} ` : ""}How far any automation on this computer may go on its own. A project can cap it lower, never higher.`}
      >
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
      </SettingsScreenField>
      {error && <Banner tone="error">{error}</Banner>}
    </div>
  );
}


/** The computer's device hosts; an EAS host can start a billed session from here. */
export function DeviceHostsPage() {
  return (
    <div className="aw-settings">
      <DeviceHostsSection />
    </div>
  );
}
