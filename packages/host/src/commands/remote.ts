import { defineTypedCommand } from "../services/command/registry";
import { claimState } from "../services/remote/deviceClaims";
import { getHostKey, listDevices } from "../services/remote/deviceStore";
import {
  approveGuest,
  denyGuest,
  listRooms,
  removeGuest,
  sayInHuddle,
  setHuddleDevice,
  setHuddleHostTyping,
  startHuddle,
  stopHuddle,
} from "../services/remote/huddleService";
import { cancelPairing, confirmPairing } from "../services/remote/pairing";
import {
  getPushConfigStatus,
  setPushConfigFromPatch,
} from "../services/remote/push/config";
import { sendTestPush } from "../services/remote/push/dispatch";
import {
  applyTailscaleFixAndOpen,
  revokeRemoteDevice,
  setRemoteDeviceGrants,
  startRemotePairing,
} from "../services/remote/remoteAdmin";
import {
  getRemoteStatus,
  setRemoteConfig,
} from "../services/remote/remoteService";
import { checkShareReadiness } from "../services/remote/shareReadiness";
import { diagnoseTailscale } from "../services/remote/tailscaleSetup";

export function registerRemoteCommands(): void {
  defineTypedCommand("remote_get_status", () => getRemoteStatus());
  defineTypedCommand("remote_get_host_key", () => getHostKey());
  defineTypedCommand("remote_set_config", (p) => setRemoteConfig(p.config));
  defineTypedCommand("remote_tailscale_diagnose", () => diagnoseTailscale());
  defineTypedCommand("remote_tailscale_fix", (p) =>
    applyTailscaleFixAndOpen(p.fix, p.url),
  );
  defineTypedCommand("remote_get_push_config", () => getPushConfigStatus());
  defineTypedCommand("remote_set_push_config", (p) =>
    setPushConfigFromPatch(p.patch),
  );
  defineTypedCommand("remote_test_push", (p) => sendTestPush(p.deviceId));
  defineTypedCommand("remote_list_devices", () => listDevices());
  defineTypedCommand("remote_revoke_device", (p) =>
    revokeRemoteDevice(p.deviceId),
  );
  defineTypedCommand("remote_start_pairing", () => startRemotePairing());
  defineTypedCommand("remote_confirm_pairing", (p) =>
    confirmPairing({ control: p.control, admin: p.admin }),
  );
  defineTypedCommand("remote_cancel_pairing", () => cancelPairing());
  defineTypedCommand("remote_set_device_control", (p) =>
    setRemoteDeviceGrants(p.deviceId, { control: p.control, admin: p.admin }),
  );
  defineTypedCommand("huddle_start", (p) =>
    startHuddle({
      agent_id: p.agentId,
      device_key: p.deviceKey ?? "",
      host_label: p.hostLabel ?? "",
    }),
  );
  defineTypedCommand("huddle_share_readiness", () => checkShareReadiness());
  defineTypedCommand("huddle_stop", (p) => stopHuddle(p.roomId));
  defineTypedCommand("huddle_set_device", (p) =>
    setHuddleDevice(p.roomId, p.deviceKey ?? ""),
  );
  defineTypedCommand("huddle_list", () => listRooms());
  defineTypedCommand("device_claim_status", (p) => claimState(p.deviceId));
  defineTypedCommand("huddle_say", (p) => sayInHuddle(p.roomId, p.text));
  defineTypedCommand("huddle_set_typing", (p) =>
    setHuddleHostTyping(p.roomId, p.typing),
  );
  defineTypedCommand("huddle_approve_guest", (p) =>
    approveGuest(p.roomId, p.devStaticPub),
  );
  defineTypedCommand("huddle_deny_guest", (p) =>
    denyGuest(p.roomId, p.devStaticPub),
  );
  defineTypedCommand("huddle_remove_guest", (p) =>
    removeGuest(p.roomId, p.devStaticPub),
  );
}
