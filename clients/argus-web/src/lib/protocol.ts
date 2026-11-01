/**
 * Wire types the client speaks, straight from `@argus/remote-protocol`'s
 * catalog. Types only: the bundle never ships zod, and nothing is validated
 * at runtime (decided in `plan/web-parity.md`).
 */

import type {
  GatewayEventPayload,
  GatewayMethod,
  GatewayParams,
  GatewayResult,
  RemoteEventType,
} from "@argus/remote-protocol";

export type {
  HuddleChatMessage,
  HuddleChatPayload,
  HuddleConnectionState,
  HuddleMember,
  HuddleStatePayload,
  PairingGrant,
  PairingPayload,
  RemoteAgentCapabilities,
  RemoteAgentStatus,
  RemoteDevice,
  RemoteDeviceClaim,
  RemoteDeviceClaimState,
  RemoteDeviceOrientation,
  RemoteDeviceState,
  RemoteFoldPose,
  RemoteGitStatus,
  RemoteImageAttachment,
  RemoteImageRef,
  RemoteMentionPathResult,
  RemoteMessage,
  RemoteModelInfo,
  RemotePermissionMode,
  RemotePermissionRequest,
  RemotePlatform,
  RemoteProject,
  RemoteQueuedMessage,
  RemoteSession,
  RemoteSlashCommand,
  RemoteTask,
  RemoteTodo,
  RemoteTokenUsage,
  RemoteToolCall,
} from "@argus/remote-protocol";
export type { EventEnvelope } from "@argus/remote-client";
export type { RemoteTranscriptDelta } from "@argus/client-core";

/** Every method this client may call: the allowlist plus the huddle plane. */
export type RemoteMethod = GatewayMethod;
export type ParamsOf<M extends GatewayMethod> = GatewayParams<M>;
export type ResultOf<M extends GatewayMethod> = GatewayResult<M>;
export type PayloadOf<E extends RemoteEventType> = GatewayEventPayload<E>;

export type RemoteTranscript = ResultOf<"agents.transcript">;
export type RemoteImageData = ResultOf<"agents.image">;
export type PermissionRespondParams = ParamsOf<"permission.respond">;
export type PermissionRespondResult = ResultOf<"permission.respond">;
export type RemoteNotification = PayloadOf<"notification">;
export type RemoteNotificationAction = RemoteNotification["actions"][number];
