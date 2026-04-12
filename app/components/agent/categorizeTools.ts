import type { ConversationMessage } from "../../stores/conversationStore";

/** Categorize tool calls into display categories. */
export function categorizeTools(messages: ConversationMessage[]) {
  const categories = {
    read: 0,
    search: 0,
    edit: 0,
    bash: 0,
    web: 0,
    agent: 0,
    other: 0,
  };
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      switch (tc.name) {
        case "Read":
          categories.read++;
          break;
        case "Glob":
        case "Grep":
        case "LS":
          categories.search++;
          break;
        case "Edit":
        case "MultiEdit":
        case "Write":
          categories.edit++;
          break;
        case "Bash":
          categories.bash++;
          break;
        case "WebSearch":
        case "WebFetch":
          categories.web++;
          break;
        case "Agent":
          categories.agent++;
          break;
        default:
          categories.other++;
          break;
      }
    }
  }

  return categories;
}
