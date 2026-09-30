import type { Equal, Expect } from "./typeEquality";
import type {
  DevicePushToken as HostDevicePushToken,
  PairedDevice as HostPairedDevice,
} from "../services/remote/deviceStore";
import type { RemoteEndpoint as HostRemoteEndpoint } from "../services/remote/endpoints";
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
import type {
  TailscaleDiagnosis as HostTailscaleDiagnosis,
  TailscaleFixKind as HostTailscaleFixKind,
  TailscaleFixResult as HostTailscaleFixResult,
  TailscaleStep as HostTailscaleStep,
} from "../services/remote/tailscaleSetup";
import type {
  CloudflareMode,
  TunnelProvider,
  TunnelState,
} from "../services/remote/tunnelManager";
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
  RemoteTunnelMode,
  RemoteTunnelProvider,
  RemoteTunnelState,
  ShareErrorPayload,
  ShareReadiness,
  TailscaleDiagnosis,
  TailscaleFixKind,
  TailscaleFixResult,
  TailscaleStep,
} from "@argus/remote-protocol";
import type { z } from "zod";

export type RemoteModelChecks = [
  Expect<Equal<DevicePushToken, HostDevicePushToken>>,
  Expect<Equal<PairedDevice, HostPairedDevice>>,
  Expect<Equal<RemoteEndpoint, HostRemoteEndpoint>>,
  Expect<Equal<RemoteTunnelProvider, TunnelProvider>>,
  Expect<Equal<RemoteTunnelMode, CloudflareMode>>,
  Expect<Equal<RemoteTunnelState, TunnelState>>,
  Expect<Equal<RemoteStatus, HostRemoteStatus>>,
  Expect<Equal<RemoteConfigPatch, Parameters<typeof setRemoteConfig>[0]>>,
  Expect<Equal<TailscaleFixKind, HostTailscaleFixKind>>,
  Expect<Equal<TailscaleStep, HostTailscaleStep>>,
  Expect<Equal<TailscaleDiagnosis, HostTailscaleDiagnosis>>,
  Expect<Equal<TailscaleFixResult, HostTailscaleFixResult>>,
  Expect<Equal<RemotePushConfig, PushConfigStatus>>,
  Expect<Equal<RemotePushConfigPatch, PushConfigPatch>>,
  Expect<Equal<RemotePushTestResult, Awaited<ReturnType<typeof sendTestPush>>>>,
  Expect<Equal<RemotePairingStart, PairingStart>>,
  Expect<Equal<ShareErrorPayload, HostShareErrorPayload>>,
  Expect<Equal<ShareReadiness, HostShareReadiness>>,
  Expect<Equal<z.infer<typeof HuddleGuestModel>, HuddleGuest>>,
  Expect<Equal<z.infer<typeof HuddleRoomModel>, HuddleRoom>>,
];
