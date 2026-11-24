import { defineTypedCommand } from "../services/command/registry";
import {
  addDuty,
  createBlankTeammate,
  createTeammateFromTemplate,
  promoteAutomation,
  removeDuty,
  saveTeammateSoul,
  teammateDetail,
  teammateSummaries,
  updateTeammate,
} from "../services/teammate/manager";
import { TEAMMATE_TEMPLATES } from "../services/teammate/templates";
import {
  archiveThread,
  deleteTeammateWithThreads,
  listThreads,
  openThread,
} from "../services/teammate/threads";

export function registerTeammateCommands(): void {
  defineTypedCommand("teammates_list", () => teammateSummaries());
  defineTypedCommand("teammate_get", (p) => teammateDetail(p.id));
  defineTypedCommand("teammate_create", (p) => createBlankTeammate(p.input));
  defineTypedCommand("teammate_update", (p) => updateTeammate(p.id, p.patch));
  defineTypedCommand("teammate_delete", (p) =>
    deleteTeammateWithThreads(p.id, p.keepDuties),
  );
  defineTypedCommand("teammate_soul_save", (p) =>
    saveTeammateSoul(p.id, p.soul),
  );
  defineTypedCommand("teammate_templates_list", () => TEAMMATE_TEMPLATES);
  defineTypedCommand("teammate_create_from_template", (p) =>
    createTeammateFromTemplate(p.templateId, p.repoRoots),
  );
  defineTypedCommand("teammate_promote_automation", (p) =>
    promoteAutomation(p.automationId, p.teammateId),
  );
  defineTypedCommand("teammate_add_duty", (p) => addDuty(p.id, p.input));
  defineTypedCommand("teammate_remove_duty", (p) => removeDuty(p.automationId));
  defineTypedCommand("teammate_threads_list", (p) => listThreads(p.id));
  defineTypedCommand("teammate_thread_open", (p) =>
    openThread(p.id, { threadId: p.threadId, fresh: p.fresh }),
  );
  defineTypedCommand("teammate_thread_archive", (p) =>
    archiveThread(p.threadId),
  );
}
