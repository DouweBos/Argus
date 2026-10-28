import { defineTypedCommand } from "../services/command/registry";
import {
  figmaDesignRef,
  figmaFrame,
} from "../services/integrations/figma/service";
import {
  connectWithKey,
  disconnect,
  getLinearIssue,
  listIntegrations,
  linearIssueContext,
  listLinearIssues,
} from "../services/integrations/service";
import { deviceScreenshot } from "../services/simulator/screenshot";

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
  defineTypedCommand("figma_design_ref", (p) => figmaDesignRef(p.url));
  defineTypedCommand("figma_frame", (p) => figmaFrame(p.url));
  defineTypedCommand("device_screenshot", (p) =>
    deviceScreenshot(p.platform, p.deviceKey),
  );
}
