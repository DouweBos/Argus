import type { Equal, Expect } from "./typeEquality";
import type {
  teammateDetail,
  teammateSummaries,
} from "../services/teammate/manager";
import type {
  CreateTeammateInput as HostCreateTeammateInput,
  Teammate as HostTeammate,
  TeammateTemplate as HostTeammateTemplate,
  UpdateTeammateInput as HostUpdateTeammateInput,
} from "../services/teammate/models";
import type {
  CreateTeammateInput,
  Teammate,
  TeammateDetail,
  TeammateSummary,
  TeammateTemplate,
  UpdateTeammateInput,
} from "@argus/remote-protocol";

export type TeammateModelChecks = [
  Expect<Equal<Teammate, HostTeammate>>,
  Expect<Equal<CreateTeammateInput, HostCreateTeammateInput>>,
  Expect<Equal<UpdateTeammateInput, HostUpdateTeammateInput>>,
  Expect<Equal<TeammateTemplate, HostTeammateTemplate>>,
  Expect<Equal<TeammateSummary[], ReturnType<typeof teammateSummaries>>>,
  Expect<Equal<TeammateDetail, ReturnType<typeof teammateDetail>>>,
];
