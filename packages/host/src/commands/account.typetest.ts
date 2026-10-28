import type { Equal, Expect } from "./typeEquality";
import type { listRequests } from "../services/account/approvals";
import type { applyPushedEntries } from "../services/account/lifecycle";
import type { LinkSurface } from "../services/account/link";
import type {
  deviceKey,
  getAccountStatus,
  linkLocalBegin,
  listHosts,
  listMembers,
  remoteAccountStatus,
} from "../services/account/service";
import type { AccountRecord } from "../services/account/store";
import type {
  AccountConfig,
  AccountDeviceKey,
  AccountHost,
  AccountJoinRequest,
  AccountLinkSurface,
  AccountLocalLinkOffer,
  AccountMemberInfo,
  AccountStatus,
  MethodResult,
} from "@argus/remote-protocol";
import type { z } from "zod";

export type AccountModelChecks = [
  Expect<Equal<Awaited<ReturnType<typeof getAccountStatus>>, AccountStatus>>,
  Expect<Equal<Awaited<ReturnType<typeof listHosts>>, AccountHost[]>>,
  Expect<Equal<ReturnType<typeof listMembers>, AccountMemberInfo[]>>,
  Expect<Equal<ReturnType<typeof deviceKey>, AccountDeviceKey | null>>,
  Expect<
    Equal<Awaited<ReturnType<typeof linkLocalBegin>>, AccountLocalLinkOffer>
  >,
  Expect<Equal<AccountRecord["config"], AccountConfig>>,
  Expect<Equal<Exclude<LinkSurface, "paired">, AccountLinkSurface>>,
  Expect<
    Equal<
      ReturnType<typeof remoteAccountStatus>,
      z.infer<(typeof MethodResult)["account.status"]>
    >
  >,
  Expect<Equal<Awaited<ReturnType<typeof listRequests>>, AccountJoinRequest[]>>,
  Expect<
    Equal<
      Awaited<ReturnType<typeof applyPushedEntries>>,
      z.infer<(typeof MethodResult)["account.sync"]>
    >
  >,
];
