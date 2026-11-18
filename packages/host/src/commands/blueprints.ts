import { createProjectFromBlueprint } from "../services/blueprint/create";
import { draftBlueprintFromProjects } from "../services/blueprint/draft";
import {
  createBlueprint,
  deleteBlueprint,
  listBlueprintRuns,
  listBlueprints,
  updateBlueprint,
} from "../services/blueprint/manager";
import { defineTypedCommand } from "../services/command/registry";

export function registerBlueprintCommands(): void {
  defineTypedCommand("blueprints_list", () => listBlueprints());
  defineTypedCommand("blueprint_create", (p) => createBlueprint(p.input));
  defineTypedCommand("blueprint_update", (p) => updateBlueprint(p.id, p.patch));
  defineTypedCommand("blueprint_delete", (p) => deleteBlueprint(p.id));
  defineTypedCommand("blueprint_create_project", (p) =>
    createProjectFromBlueprint(p.input),
  );
  defineTypedCommand("blueprint_runs_list", (p) =>
    listBlueprintRuns(p.blueprintId),
  );
  defineTypedCommand("blueprint_draft", (p) =>
    draftBlueprintFromProjects(p.paths),
  );
}
