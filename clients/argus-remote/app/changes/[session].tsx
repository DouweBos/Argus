/**
 * Read-only changes review for a session — git status summary plus the diff of
 * what the agent changed. A toggle switches between the branch diff (vs the
 * base branch) and the working diff (uncommitted vs HEAD).
 */

import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { FileDiffCard } from "../../src/components/FileDiffCard";
import * as Icons from "../../src/components/Icons";
import {
  EmptyState,
  Loading,
  Muted,
  Row,
  Screen,
  SegmentedControl,
  StatusDot,
} from "../../src/components/ui";
import { parseDiff } from "../../src/lib/diff";
import { useAppStore } from "../../src/stores/appStore";
import { useTheme } from "../../src/theme";

type Mode = "branch" | "working";

const MODE_OPTIONS = [
  { value: "branch" as const, label: "Vs base branch" },
  { value: "working" as const, label: "Uncommitted" },
];

const POLL_MS = 5000;

export default function ChangesScreen() {
  const theme = useTheme();
  const { session, label } = useLocalSearchParams<{
    session: string;
    label?: string;
  }>();
  const sessionId = session ?? "";

  const connection = useAppStore((s) => s.connection);
  const status = useAppStore((s) => s.gitStatusBySession[sessionId]);
  const loadGitStatus = useAppStore((s) => s.loadGitStatus);
  const loadDiff = useAppStore((s) => s.loadDiff);
  const [mode, setMode] = useState<Mode>("branch");
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    loadGitStatus(sessionId).catch(() => {});
    loadDiff(sessionId, mode)
      .then((r) => setDiff(r.diff))
      .catch(() => setDiff(""))
      .finally(() => setLoading(false));
  }, [sessionId, mode, loadGitStatus, loadDiff]);

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    setLoading(true);
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refresh();
      }
    });

    return () => {
      clearInterval(poll);
      sub.remove();
    };
  }, [connection, refresh]);

  const files = diff ? parseDiff(diff) : [];

  return (
    <Screen>
      <Stack.Screen options={{ title: `Changes · ${label ?? ""}`.trim() }} />

      <SegmentedControl<Mode> value={mode} options={MODE_OPTIONS} onChange={setMode} />

      {status && (
        <Row gap={8}>
          <StatusDot tone={status.conflict_count > 0 ? "warning" : "accent"} />
          <Muted numberOfLines={1} style={{ flex: 1 }}>
            {status.branch}
            {status.ahead > 0 ? ` ↑${status.ahead}` : ""}
            {status.behind > 0 ? ` ↓${status.behind}` : ""}
            {" · "}
            {status.dirty_count > 0 ? `${status.dirty_count} changed` : "clean"}
            {status.conflict_count > 0 ? ` · ${status.conflict_count} conflicts` : ""}
          </Muted>
        </Row>
      )}

      {loading && diff === null ? (
        <Loading label="Loading changes…" />
      ) : files.length === 0 ? (
        <EmptyState
          icon={<Icons.Branch size={22} color={theme.textMuted} />}
          title="No changes"
          body={
            mode === "branch"
              ? "This session has no changes vs its base branch — try Uncommitted for working-tree edits."
              : "No uncommitted changes in the working tree."
          }
        />
      ) : (
        files.map((f) => <FileDiffCard key={f.newPath || f.oldPath} file={f} />)
      )}
    </Screen>
  );
}
