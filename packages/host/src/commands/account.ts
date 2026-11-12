import type { CommandName, ParamsOf, ResultOf } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import {
  approveJoin,
  confirmJoin,
  denyJoin,
  listRequests,
} from "../services/account/approvals";
import { cancelLink, confirmLink, startLink } from "../services/account/link";
import { renameMember, revokeMember } from "../services/account/members";
import { setComputerName } from "../services/account/name";
import { dismissReset } from "../services/account/reset";
import {
  deviceKey,
  getAccountStatus,
  linkLocalBegin,
  linkLocalFinish,
  listHosts,
  listMembers,
  logout,
  setAccountConfig,
} from "../services/account/service";
import { defineTypedCommand } from "../services/command/registry";

/** Like `defineTypedCommand`, but a refusal also lands in host.log: the app shows it in one place at most. */
function defineAccountCommand<N extends CommandName>(
  name: N,
  handler: (params: ParamsOf<N>) => Promise<ResultOf<N>> | ResultOf<N>,
): void {
  defineTypedCommand(name, async (params) => {
    try {
      return await handler(params);
    } catch (err) {
      warn(
        `[account] ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  });
}

export function registerAccountCommands(): void {
  defineAccountCommand("account_get_status", () => getAccountStatus());
  defineAccountCommand("account_list_hosts", () => listHosts());
  defineAccountCommand("account_list_members", () => listMembers());
  defineAccountCommand("account_device_key", () => deviceKey());
  defineAccountCommand("account_login_start", (p) => startLink(p.surface));
  defineAccountCommand("account_login_confirm", (p) => confirmLink(p.match));
  defineAccountCommand("account_login_cancel", () => cancelLink());
  defineAccountCommand("account_logout", () => logout());
  defineAccountCommand("account_link_local_begin", () => linkLocalBegin());
  defineAccountCommand("account_link_local_finish", (p) => linkLocalFinish(p));
  defineAccountCommand("account_list_requests", () => listRequests());
  defineAccountCommand("account_approve_join", (p) => approveJoin(p.requestId));
  defineAccountCommand("account_confirm_join", (p) => confirmJoin(p.match));
  defineAccountCommand("account_deny_join", (p) => denyJoin(p.requestId));
  defineAccountCommand("account_revoke_member", (p) =>
    revokeMember(p.memberId),
  );
  defineAccountCommand("account_rename_member", (p) =>
    renameMember(p.memberId, p.name),
  );
  defineAccountCommand("account_set_name", (p) =>
    setComputerName(p.name, "settings"),
  );
  defineAccountCommand("account_dismiss_reset", () => dismissReset());
  defineAccountCommand("account_set_config", (p) => setAccountConfig(p.patch));
}
