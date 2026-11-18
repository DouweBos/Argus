import type { Equal, Expect } from "./typeEquality";
import type { createProjectFromBlueprint } from "../services/blueprint/create";
import type { draftBlueprintFromProjects } from "../services/blueprint/draft";
import type {
  createBlueprint,
  listBlueprintRuns,
  listBlueprints,
} from "../services/blueprint/manager";
import type {
  Blueprint,
  BlueprintDraft,
  BlueprintRun,
} from "@argus/remote-protocol";

export type BlueprintModelChecks = [
  Expect<Equal<ReturnType<typeof listBlueprints>, Blueprint[]>>,
  Expect<Equal<ReturnType<typeof createBlueprint>, Blueprint>>,
  Expect<Equal<ReturnType<typeof listBlueprintRuns>, BlueprintRun[]>>,
  Expect<
    Equal<Awaited<ReturnType<typeof createProjectFromBlueprint>>, BlueprintRun>
  >,
  Expect<
    Equal<
      Awaited<ReturnType<typeof draftBlueprintFromProjects>>,
      BlueprintDraft
    >
  >,
];
