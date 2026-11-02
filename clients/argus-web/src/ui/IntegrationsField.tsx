/** Settings: which integrations the computer has connected, and as whom. */

import { useCallback, useEffect, useMemo } from "react";
import {
  IntegrationStatusList,
  SettingsGroup,
} from "@argus/peacock";
import { integrationView } from "@argus/client-core";
import { useConnectionStore } from "../stores/connection";
import { useIntegrationsStore } from "../stores/integrations";

export function IntegrationsField() {
  const connection = useConnectionStore((s) => s.connection);
  const integrations = useIntegrationsStore((s) => s.integrations);
  const load = useIntegrationsStore((s) => s.integrationsLoad);
  const refreshIntegrations = useIntegrationsStore(
    (s) => s.refreshIntegrations,
  );

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

  return (
    <SettingsGroup
      footer="Connect or disconnect them in Argus on the computer."
      title="Integrations"
    >
      <div className="aw-settings-card-body">
        <IntegrationStatusList
        error={load.error}
        integrations={load.loaded || rows.length > 0 ? rows : null}
        onRetry={() => refresh(false)}
        />
      </div>
    </SettingsGroup>
  );
}
