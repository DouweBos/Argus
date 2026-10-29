import { defineTypedCommand } from "../services/command/registry";
import { compareToDesign } from "../services/design/compare";
import {
  figmaDesignRef,
  figmaFrame,
  figmaFrameDetails,
} from "../services/integrations/figma/service";
import {
  cancelOAuth,
  commentOnLinearIssueById,
  connectWithKey,
  connectWithOAuth,
  disconnect,
  getLinearIssue,
  listIntegrations,
  fileLinearIssue,
  linearIssueContext,
  linearMedia,
  linearTeamStates,
  listLinearTeams,
  listLinearIssues,
  updateLinearIssue,
} from "../services/integrations/service";
import { devicePng, deviceScreenshot } from "../services/simulator/screenshot";

export function registerIntegrationCommands(): void {
  defineTypedCommand("list_integrations", () => listIntegrations());
  defineTypedCommand("integration_connect_with_key", (p) =>
    connectWithKey(p.id, p.key),
  );
  defineTypedCommand("integration_connect_oauth", (p) =>
    connectWithOAuth(p.id),
  );
  defineTypedCommand("integration_cancel_oauth", () => cancelOAuth());
  defineTypedCommand("integration_disconnect", (p) => disconnect(p.id));
  defineTypedCommand("linear_list_issues", (p) =>
    listLinearIssues(p.query ?? null, p.limit, p.scope),
  );
  defineTypedCommand("linear_get_issue", (p) => getLinearIssue(p.ref));
  defineTypedCommand("linear_issue_context", (p) => linearIssueContext(p.ref));
  defineTypedCommand("linear_list_teams", () => listLinearTeams());
  defineTypedCommand("linear_media", (p) => linearMedia(p.url));
  defineTypedCommand("linear_team_states", (p) => linearTeamStates(p.teamId));
  defineTypedCommand("linear_update_issue", (p) =>
    updateLinearIssue(p.issueId, { priority: p.priority, stateId: p.stateId }),
  );
  defineTypedCommand("linear_comment_issue", (p) =>
    commentOnLinearIssueById(p.issueId, p.body, p.parentId ?? null),
  );
  defineTypedCommand("linear_file_issue", (p) =>
    fileLinearIssue({ ...p, screenshot: p.screenshot ?? null }),
  );
  defineTypedCommand("figma_design_ref", (p) => figmaDesignRef(p.url));
  defineTypedCommand("figma_frame", (p) => figmaFrame(p.url));
  defineTypedCommand("figma_frame_details", (p) => figmaFrameDetails(p.url));
  defineTypedCommand("design_compare", async (p) => {
    const png = await devicePng(p.platform, p.deviceKey);
    if (!png) {
      throw "Couldn't take a screenshot of that device.";
    }

    return compareToDesign(p.url, png, "app");
  });
  defineTypedCommand("device_screenshot", (p) =>
    deviceScreenshot(p.platform, p.deviceKey),
  );
}
