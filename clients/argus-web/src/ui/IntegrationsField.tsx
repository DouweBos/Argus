/**
 * Settings: which integrations the computer has connected, and as whom. With
 * control, connect one with a key or disconnect it; browser sign-in answers on
 * the computer's own loopback, so it stays in Argus there.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { IntegrationId } from "@argus/remote-protocol";
import {
  Banner,
  Button,
  ConfirmDialog,
  IntegrationStatusList,
  SettingsGroup,
} from "@argus/peacock";
import { describeError, integrationView } from "@argus/client-core";
import { useConnectionStore } from "../stores/connection";
import { useIntegrationsStore } from "../stores/integrations";
import { capture } from "../telemetry/telemetry";
import { IntegrationKeyDialog } from "./IntegrationKeyDialog";

export function IntegrationsField() {
  const connection = useConnectionStore((s) => s.connection);
  const control = useConnectionStore((s) => s.capabilities.includes("control"));
  const integrations = useIntegrationsStore((s) => s.integrations);
  const load = useIntegrationsStore((s) => s.integrationsLoad);
  const refreshIntegrations = useIntegrationsStore(
    (s) => s.refreshIntegrations,
  );
  const disconnect = useIntegrationsStore((s) => s.disconnectIntegration);
  const [connecting, setConnecting] = useState<IntegrationId | null>(null);
  const [disconnecting, setDisconnecting] = useState<IntegrationId | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    (background: boolean) => {
      refreshIntegrations({ background }).catch(() => {});
    },
    [refreshIntegrations],
  );

  useEffect(() => {
    if (connection === "ready") {
      refresh(true);
    }
  }, [connection, refresh]);

  const rows = useMemo(() => integrations.map(integrationView), [integrations]);
  // A guest is refused the list; there is nothing to show them.
  if (load.loaded && load.error && rows.length === 0) {
    return null;
  }
  const nameOf = (id: IntegrationId) =>
    rows.find((r) => r.id === id)?.name ?? id;

  const confirmDisconnect = async (id: IntegrationId) => {
    setDisconnecting(null);
    try {
      await disconnect(id);
      setError(null);
      capture("web_integration_changed", {
        provider: id,
        action: "disconnect",
        success: true,
      });
    } catch (err) {
      setError(describeError(err));
      capture("web_integration_changed", {
        provider: id,
        action: "disconnect",
        success: false,
      });
    }
  };

  return (
    <SettingsGroup
      footer={
        control
          ? "Keys typed here go to the computer's secret store and never come back to this browser."
          : "Connect or disconnect them in Argus on the computer."
      }
      title="Integrations"
    >
      <div className="aw-settings-card-body">
        {error && <Banner tone="error">{error}</Banner>}
        <IntegrationStatusList
          error={load.error}
          integrations={load.loaded || rows.length > 0 ? rows : null}
          renderAction={
            control
              ? (row) => {
                  const id = row.id as IntegrationId;
                  const connected = integrations.some(
                    (i) => i.id === id && i.connected,
                  );

                  return connected ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDisconnecting(id)}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setConnecting(id)}
                    >
                      Connect
                    </Button>
                  );
                }
              : undefined
          }
          onRetry={() => refresh(false)}
        />
      </div>
      {connecting && (
        <IntegrationKeyDialog
          id={connecting}
          name={nameOf(connecting)}
          onClose={() => setConnecting(null)}
        />
      )}
      {disconnecting && (
        <ConfirmDialog
          destructive
          confirmLabel="Disconnect"
          title={`Disconnect ${nameOf(disconnecting)}?`}
          titleId="aw-integration-disconnect"
          onCancel={() => setDisconnecting(null)}
          onConfirm={() => void confirmDisconnect(disconnecting)}
        >
          Argus on the computer stops reading {nameOf(disconnecting)} until
          you connect it again.
        </ConfirmDialog>
      )}
    </SettingsGroup>
  );
}
