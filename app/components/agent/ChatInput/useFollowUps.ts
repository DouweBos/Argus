import { useCallback, useMemo, useState } from "react";
import { followUpCompletion } from "@argus/peacock";
import { capture } from "../../../lib/telemetry";

interface Ghost {
  hint: string;
  text: string;
}

/**
 * Follow-up suggestions in an uncontrolled textarea: chips and a placeholder
 * while it is empty, ghost text completing a typed prefix, and `fill` to take
 * one. `sync` re-reads the textarea after anything changes its value.
 */
export function useFollowUps(
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  followUps: string[] | undefined,
  onFilled: (value: string) => void,
) {
  const items = useMemo(() => followUps ?? [], [followUps]);
  // The textarea is seeded from a draft after mount; `sync` reads it then.
  const [value, setValue] = useState("");

  const sync = useCallback(() => {
    setValue(textareaRef.current?.value ?? "");
  }, [textareaRef]);

  const completion = followUpCompletion(value, items);
  const ghost: Ghost | null = completion
    ? { text: value, hint: completion }
    : null;
  const isEmpty = value.trim().length === 0;
  const chips = isEmpty ? items : [];
  const placeholder = isEmpty ? (items[0] ?? null) : null;

  const fill = useCallback(
    (text: string, method: "click" | "tab") => {
      const el = textareaRef.current;
      if (!el) {
        return;
      }
      el.value = text;
      el.focus();
      el.setSelectionRange(text.length, text.length);
      setValue(text);
      onFilled(text);
      capture("follow_up_used", { method });
    },
    [textareaRef, onFilled],
  );

  /** Tab takes the completion, or the first suggestion into an empty input. */
  const acceptWithTab = useCallback((): boolean => {
    if (completion) {
      fill(value + completion, "tab");

      return true;
    }
    if (isEmpty && items[0]) {
      fill(items[0], "tab");

      return true;
    }

    return false;
  }, [completion, fill, isEmpty, items, value]);

  return { chips, ghost, placeholder, fill, acceptWithTab, sync };
}
