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

export function registerAccountCommands(): void {
  defineTypedCommand("account_get_status", () => getAccountStatus());
  defineTypedCommand("account_list_hosts", () => listHosts());
  defineTypedCommand("account_list_members", () => listMembers());
  defineTypedCommand("account_device_key", () => deviceKey());
  defineTypedCommand("account_login_start", (p) => startLink(p.surface));
  defineTypedCommand("account_login_confirm", (p) => confirmLink(p.match));
  defineTypedCommand("account_login_cancel", () => cancelLink());
  defineTypedCommand("account_logout", () => logout());
  defineTypedCommand("account_link_local_begin", () => linkLocalBegin());
  defineTypedCommand("account_link_local_finish", (p) => linkLocalFinish(p));
  defineTypedCommand("account_list_requests", () => listRequests());
  defineTypedCommand("account_approve_join", (p) => approveJoin(p.requestId));
  defineTypedCommand("account_confirm_join", (p) => confirmJoin(p.match));
  defineTypedCommand("account_deny_join", (p) => denyJoin(p.requestId));
  defineTypedCommand("account_revoke_member", (p) => revokeMember(p.memberId));
  defineTypedCommand("account_rename_member", (p) =>
    renameMember(p.memberId, p.name),
  );
  defineTypedCommand("account_set_name", (p) =>
    setComputerName(p.name, "settings"),
  );
  defineTypedCommand("account_dismiss_reset", () => dismissReset());
  defineTypedCommand("account_set_config", (p) => setAccountConfig(p.patch));
}
