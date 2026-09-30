import type { Equal, Expect } from "./typeEquality";
import type { ImageAttachment as HostImageAttachment } from "../services/agent/agentService";
import type {
  ChatHistoryEntry as HostChatHistoryEntry,
  ChatHistoryMessageMatch as HostChatHistoryMessageMatch,
  ChatHistorySearchResult as HostChatHistorySearchResult,
  SavedConversation as HostSavedConversation,
} from "../services/agent/chatHistory";
import type { Checkpoint as HostCheckpoint } from "../services/agent/checkpoints";
import type {
  QueuedImage as HostQueuedImage,
  QueuedMessage as HostQueuedMessage,
} from "../services/agent/messageQueue";
import type {
  AgentInfo as HostAgentInfo,
  AgentStatusValue as HostAgentStatusValue,
} from "../services/agent/models";
import type { InitializeResponse } from "../services/llm/runners/claudeCode/protocol";
import type { AgentNotificationInput as HostAgentNotificationInput } from "../services/notifications/osNotification";
import type {
  AgentCapabilities,
  AgentInfo,
  AgentNotificationInput,
  AgentStatusValue,
  ChatHistoryEntry,
  ChatHistoryMessageMatch,
  ChatHistorySearchResult,
  Checkpoint,
  ImageAttachment,
  QueuedImage,
  QueuedMessage,
  SavedConversation,
} from "@argus/remote-protocol";

export type AgentModelChecks = [
  Expect<Equal<AgentStatusValue, HostAgentStatusValue>>,
  Expect<Equal<AgentCapabilities, InitializeResponse>>,
  Expect<Equal<AgentInfo, HostAgentInfo>>,
  Expect<Equal<ImageAttachment, HostImageAttachment>>,
  Expect<Equal<QueuedImage, HostQueuedImage>>,
  Expect<Equal<QueuedMessage, HostQueuedMessage>>,
  Expect<Equal<Checkpoint, HostCheckpoint>>,
  Expect<Equal<ChatHistoryEntry, HostChatHistoryEntry>>,
  Expect<Equal<SavedConversation, HostSavedConversation>>,
  Expect<Equal<ChatHistoryMessageMatch, HostChatHistoryMessageMatch>>,
  Expect<Equal<ChatHistorySearchResult, HostChatHistorySearchResult>>,
  Expect<Equal<AgentNotificationInput, HostAgentNotificationInput>>,
];
