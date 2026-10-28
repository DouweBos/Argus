import type { Equal, Expect } from "./typeEquality";
import type {
  DevicePushToken as HostDevicePushToken,
  PairedDevice as HostPairedDevice,
} from "../services/remote/deviceStore";
import type { RemoteEndpoint as HostRemoteEndpoint } from "../services/remote/endpoints";
import type {
  LegacyTunnelKind as HostLegacyTunnelKind,
  LegacyTunnelState as HostLegacyTunnelState,
} from "../services/remote/legacyTunnels";
import type { ManagedTunnelState as HostManagedTunnelState } from "../services/remote/managedTunnel";
import type { PairingStart } from "../services/remote/pairing";
import type {
  PushConfigPatch,
  PushConfigStatus,
} from "../services/remote/push/config";
import type { sendTestPush } from "../services/remote/push/dispatch";
import type {
  RemoteStatus as HostRemoteStatus,
  setRemoteConfig,
} from "../services/remote/remoteService";
import type { ShareErrorPayload as HostShareErrorPayload } from "../services/remote/shareError";
import type { ShareReadiness as HostShareReadiness } from "../services/remote/shareReadiness";
import type { TunnelStatus } from "../services/remote/tunnelManager";
import type {
  DevicePushToken,
  HuddleGuest,
  HuddleGuestModel,
  HuddleRoom,
  HuddleRoomModel,
  PairedDevice,
  RemoteConfigPatch,
  RemoteEndpoint,
  RemotePairingStart,
  RemotePushConfig,
  RemotePushConfigPatch,
  RemotePushTestResult,
  RemoteStatus,
  LegacyTunnelKind,
  LegacyTunnelState,
  ManagedTunnelState,
  RemoteTunnelStatus,
  ShareErrorPayload,
  ShareReadiness,
} from "@argus/remote-protocol";
import type { z } from "zod";

export type RemoteModelChecks = [
  Expect<Equal<DevicePushToken, HostDevicePushToken>>,
  Expect<Equal<PairedDevice, HostPairedDevice>>,
  Expect<Equal<RemoteEndpoint, HostRemoteEndpoint>>,
  Expect<Equal<RemoteTunnelStatus, TunnelStatus>>,
  Expect<Equal<LegacyTunnelKind, HostLegacyTunnelKind>>,
  Expect<Equal<LegacyTunnelState, HostLegacyTunnelState>>,
  Expect<Equal<ManagedTunnelState, HostManagedTunnelState>>,
  Expect<Equal<RemoteStatus, HostRemoteStatus>>,
  Expect<Equal<RemoteConfigPatch, Parameters<typeof setRemoteConfig>[0]>>,
  Expect<Equal<RemotePushConfig, PushConfigStatus>>,
  Expect<Equal<RemotePushConfigPatch, PushConfigPatch>>,
  Expect<Equal<RemotePushTestResult, Awaited<ReturnType<typeof sendTestPush>>>>,
  Expect<Equal<RemotePairingStart, PairingStart>>,
  Expect<Equal<ShareErrorPayload, HostShareErrorPayload>>,
  Expect<Equal<ShareReadiness, HostShareReadiness>>,
  Expect<Equal<z.infer<typeof HuddleGuestModel>, HuddleGuest>>,
  Expect<Equal<z.infer<typeof HuddleRoomModel>, HuddleRoom>>,
];
