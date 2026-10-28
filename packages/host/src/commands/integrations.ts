import { defineTypedCommand } from "../services/command/registry";
import {
  connectWithKey,
  disconnect,
  getLinearIssue,
  listIntegrations,
  linearIssueContext,
  listLinearIssues,
} from "../services/integrations/service";

export function registerIntegrationCommands(): void {
  defineTypedCommand("list_integrations", () => listIntegrations());
  defineTypedCommand("integration_connect_with_key", (p) =>
    connectWithKey(p.id, p.key),
  );
  defineTypedCommand("integration_disconnect", (p) => disconnect(p.id));
  defineTypedCommand("linear_list_issues", (p) =>
    listLinearIssues(p.query ?? null, p.limit),
  );
  defineTypedCommand("linear_get_issue", (p) => getLinearIssue(p.ref));
  defineTypedCommand("linear_issue_context", (p) => linearIssueContext(p.ref));
}
