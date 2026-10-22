import { useEffect, useState } from "react";
import { SettingsScreenField, Toggle } from "@argus/peacock";
import { getAppSettings, setAppSettings } from "../../../lib/ipc";

/**
 * Whether a finished turn gets suggested replies. Host state rather than
 * renderer state: the host makes the call, and every client shows the result.
 */
export function FollowUpSuggestionsToggle() {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAppSettings().then(
      (settings) => {
        if (!cancelled) {
          setEnabled(settings.follow_up_suggestions !== false);
          setLoaded(true);
        }
      },
      () => {
        if (!cancelled) {
          setLoaded(true);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, []);

  const change = (next: boolean) => {
    setEnabled(next);
    setAppSettings({ follow_up_suggestions: next }).catch(() => {
      setEnabled(!next);
    });
  };

  return (
    <SettingsScreenField
      label="Follow-up suggestions"
      caption="When an agent finishes, a small model reads its last message and suggests replies you can pick in the chat input."
    >
      <Toggle checked={enabled} disabled={!loaded} onChange={change}>
        Suggest replies
      </Toggle>
    </SettingsScreenField>
  );
}
