/**
 * The gateway's view of teammates. Duties go out in the automation wire shape
 * the phones already render; everything else is the catalog's own model.
 */

import type {
  AutomationInput,
  RemoteAutomation,
  RemoteTeammateTemplate,
} from "@argus/remote-protocol";
import { addDuty, removeDuty, teammateDetail } from "../teammate/manager";
import { TEAMMATE_TEMPLATES } from "../teammate/templates";
import {
  toCreateAutomationInput,
  toRemoteAutomation,
} from "./automationsRemote";

export function remoteTeammate(id: string) {
  const detail = teammateDetail(id);

  return { ...detail, duties: detail.duties.map(toRemoteAutomation) };
}

export function remoteTeammateTemplates(): {
  templates: RemoteTeammateTemplate[];
} {
  return {
    templates: TEAMMATE_TEMPLATES.map(({ duties, ...template }) => ({
      ...template,
      duty_names: duties.map((d) => d.name),
    })),
  };
}

export function addRemoteDuty(
  teammateId: string,
  input: AutomationInput,
): { automation: RemoteAutomation } {
  return {
    automation: toRemoteAutomation(
      addDuty(teammateId, toCreateAutomationInput(input)),
    ),
  };
}

export function removeRemoteDuty(automationId: string): {
  automation: RemoteAutomation;
} {
  return { automation: toRemoteAutomation(removeDuty(automationId)) };
}
