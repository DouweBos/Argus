import type { SlashCommand } from "../../../lib/types";
import { type RefObject, useCallback, useState } from "react";
import { useMentionPicker } from "../ChatInput/useMentionPicker";

interface PromptAssistOptions {
  onPromptChange: (next: string) => void;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  /** Mentions resolve against this session's files. */
  sessionId: string;
  slashCommands: SlashCommand[];
}

const ARROW_STEPS: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };

/** `/` command suggestions and `@` file mentions for a prompt box. */
export function usePromptAssist({
  onPromptChange,
  promptRef,
  sessionId,
  slashCommands,
}: PromptAssistOptions) {
  const [suggestions, setSuggestions] = useState<SlashCommand[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const mention = useMentionPicker(sessionId);
  const { updateMentions } = mention;

  const updateSuggestions = useCallback(
    (value: string) => {
      if (
        slashCommands.length > 0 &&
        value.startsWith("/") &&
        !value.includes(" ") &&
        !value.includes("\n")
      ) {
        const query = value.slice(1).toLowerCase();
        setSuggestions(
          slashCommands
            .filter((c) => c.name.toLowerCase().includes(query))
            .slice(0, 8),
        );
        setSuggestionIndex(0);
      } else {
        setSuggestions([]);
      }
    },
    [slashCommands],
  );

  const applySuggestion = useCallback(
    (index: number) => {
      const cmd = suggestions[index];
      if (!cmd) {
        return;
      }
      onPromptChange(`/${cmd.name} `);
      setSuggestions([]);
      promptRef.current?.focus();
    },
    [onPromptChange, promptRef, suggestions],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onPromptChange(e.target.value);
      updateSuggestions(e.target.value);
      updateMentions(promptRef.current);
    },
    [onPromptChange, promptRef, updateMentions, updateSuggestions],
  );

  /** Handles the key when a picker is open; returns whether it did. */
  const handlePickerKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const accept = e.key === "Tab" || (e.key === "Enter" && !e.shiftKey);
      const step = ARROW_STEPS[e.key] ?? 0;
      if (suggestions.length > 0) {
        if (step !== 0) {
          setSuggestionIndex((i) =>
            Math.min(Math.max(i + step, 0), suggestions.length - 1),
          );
        } else if (accept) {
          applySuggestion(suggestionIndex);
        } else if (e.key === "Escape") {
          setSuggestions([]);
        } else {
          return false;
        }
        e.preventDefault();

        return true;
      }
      if (!mention.mentionContext) {
        return false;
      }
      const count = mention.items.length;
      if (count > 0 && step !== 0) {
        mention.setSelectedIndex((i: number) =>
          Math.min(Math.max(i + step, 0), count - 1),
        );
      } else if (count > 0 && accept) {
        mention.selectItem(promptRef.current, mention.selectedIndex);
      } else if (e.key === "Escape") {
        mention.dismissMention();
      } else {
        return false;
      }
      e.preventDefault();

      return true;
    },
    [applySuggestion, mention, promptRef, suggestionIndex, suggestions.length],
  );

  return {
    handleChange: onChange,
    handleMentionIndexChange: mention.setSelectedIndex,
    handlePickerKey,
    handleSelectSuggestion: applySuggestion,
    handleSuggestionIndexChange: setSuggestionIndex,
    mention,
    suggestionIndex,
    suggestions,
  };
}
