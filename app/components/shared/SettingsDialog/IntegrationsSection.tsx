import type { IntegrationId, IntegrationStatus } from "../../../lib/types";
import { useCallback, useEffect, useState } from "react";
import {
  AccountRow,
  Button,
  Input,
  SettingsScreenDetail,
  SettingsScreenDetailBody,
  SettingsScreenDetailHeader,
  SettingsScreenField,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  cancelIntegrationOAuth,
  connectIntegrationWithKey,
  connectIntegrationWithOAuth,
  disconnectIntegration,
  listIntegrations,
  openExternalUrl,
} from "../../../lib/ipc";
import styles from "./IntegrationsSection.module.css";
import { LinearOptions } from "./LinearOptions";

const LINEAR_KEYS_URL = "https://linear.app/settings/account/security";
const FIGMA_KEYS_URL = "https://www.figma.com/settings";

function accountDetail(status: IntegrationStatus): string | undefined {
  const parts = [status.account?.workspace, status.account?.email].filter(
    Boolean,
  );

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function IntegrationsSection() {
  const [statuses, setStatuses] = useState<IntegrationStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listIntegrations().then(setStatuses, (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  useEffect(refresh, [refresh]);

  useIpcEvent("integration_status_changed", refresh);

  const linear = statuses.find((s) => s.id === "linear");
  const figma = statuses.find((s) => s.id === "figma");

  return (
    <SettingsScreenDetail>
      <SettingsScreenDetailHeader
        description="Start agents from your issues, and give them the designs to match. Argus keeps its own sign-in, so agents don't depend on a separate MCP login."
        title="Integrations"
      />
      <SettingsScreenDetailBody>
        {linear && (
          <IntegrationField
            id="linear"
            keyCaption="Create a personal API key in Linear under Settings → Security & access. It doesn't expire and only acts as you."
            keysUrl={LINEAR_KEYS_URL}
            label="Linear"
            status={linear}
            onError={setError}
          />
        )}
        {linear?.connected && <LinearOptions />}
        {figma && (
          <IntegrationField
            id="figma"
            keyCaption="Create a personal access token in Figma under Settings → Security with read access to files and comments."
            keysUrl={FIGMA_KEYS_URL}
            label="Figma"
            status={figma}
            onError={setError}
          />
        )}
        {error && <p className={styles.error}>{error}</p>}
      </SettingsScreenDetailBody>
    </SettingsScreenDetail>
  );
}

function IntegrationField({
  id,
  label,
  status,
  keyCaption,
  keysUrl,
  onError,
}: {
  id: IntegrationId;
  keyCaption: string;
  keysUrl: string;
  label: string;
  onError: (message: string | null) => void;
  status: IntegrationStatus;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await action();
      setKey("");
      setEditing(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showKeyForm = !status.connected || editing;

  return (
    <SettingsScreenField
      label={label}
      caption={showKeyForm ? keyCaption : undefined}
    >
      <div className={styles.field}>
        {status.connected && status.account && (
          <AccountRow
            active
            busy={busy}
            detail={accountDetail(status)}
            label={status.account.name}
            needsReauth={status.needsReauth}
            onReauth={() => setEditing(true)}
            onRemove={() => run(() => disconnectIntegration(id))}
          />
        )}
        {showKeyForm && status.oauthAvailable && (
          <div className={styles.actions}>
            {signingIn ? (
              <Button
                variant="ghost"
                onClick={() => cancelIntegrationOAuth().catch(() => {})}
              >
                Cancel sign-in
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => {
                setSigningIn(true);
                run(() => connectIntegrationWithOAuth(id)).finally(() =>
                  setSigningIn(false),
                );
              }}
            >
              {signingIn ? "Waiting for the browser…" : `Sign in with ${label}`}
            </Button>
          </div>
        )}
        {showKeyForm && (
          <div className={styles.keyForm}>
            <Input
              autoFocus={editing}
              placeholder={id === "figma" ? "Personal access token" : "API key"}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && key.trim()) {
                  run(() => connectIntegrationWithKey(id, key));
                }
              }}
            />
            <div className={styles.actions}>
              <Button
                variant="ghost"
                onClick={() => openExternalUrl(keysUrl).catch(() => {})}
              >
                Get a key
              </Button>
              {editing && (
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
              <Button
                variant="primary"
                disabled={!key.trim() || busy}
                onClick={() => run(() => connectIntegrationWithKey(id, key))}
              >
                {busy ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SettingsScreenField>
  );
}
