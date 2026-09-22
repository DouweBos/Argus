import { useEffect, useState } from "react";
import { getGitAuthor } from "../../../lib/ipc";
import { useHuddleDisplayName } from "../../../stores/settingsStore";

/**
 * What to call the engineer in a huddle — on the invite, on their messages,
 * and in the typing line.
 *
 * Falls back to the session's git `user.name` so this works without anyone
 * configuring anything; the setting exists for people who commit under a name
 * they don't go by. Empty when neither is known, which the clients render as
 * "the host" rather than inventing a name.
 */
export function useHostName(sessionId: string): string {
  const configured = useHuddleDisplayName();
  const [gitName, setGitName] = useState("");

  useEffect(() => {
    if (configured.trim()) {
      return;
    }
    let live = true;
    getGitAuthor(sessionId)
      .then(([name]) => {
        if (live) {
          setGitName(name);
        }
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [configured, sessionId]);

  return configured.trim() || gitName;
}
