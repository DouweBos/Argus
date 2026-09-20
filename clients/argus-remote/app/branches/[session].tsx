/**
 * Branch control for a project root: switch, create, and delete. Session
 * worktrees are pinned to their branch, so the computer only accepts these on
 * a project root — the project screen only links here for that session.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import * as Icons from "../../src/components/Icons";
import {
  Badge,
  Body,
  Btn,
  Card,
  EmptyState,
  Loading,
  Muted,
  Row,
  Screen,
  SectionHeader,
  TextField,
} from "../../src/components/ui";
import type { RemoteGitBranch } from "../../src/lib/protocol";
import { useAppStore } from "../../src/stores/appStore";
import { useTheme } from "../../src/theme";

export default function BranchesScreen() {
  const theme = useTheme();
  const { session, repo, label } = useLocalSearchParams<{
    session: string;
    repo: string;
    label?: string;
  }>();
  const sessionId = session ?? "";
  const repoRoot = repo ?? "";

  const connection = useAppStore((s) => s.connection);
  const listBranches = useAppStore((s) => s.listBranches);
  const checkoutBranch = useAppStore((s) => s.checkoutBranch);
  const deleteBranch = useAppStore((s) => s.deleteBranch);
  const [branches, setBranches] = useState<RemoteGitBranch[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    listBranches(sessionId)
      .then(setBranches)
      .catch(() => setBranches([]));
  }, [listBranches, sessionId]);

  useEffect(() => {
    if (connection === "ready") {
      refresh();
    }
  }, [connection, refresh]);

  const current = branches?.find((b) => b.is_current)?.name;

  const switchTo = useCallback(
    (branch: string, dirty?: "stash" | "discard") => {
      // Recurse through a local binding: the retry prompts re-enter the same
      // flow, and referencing the memoized `switchTo` from inside itself is a
      // use-before-declaration.
      const run = (mode?: "stash" | "discard") => {
        setBusy(branch);
        checkoutBranch(sessionId, repoRoot, branch, mode)
          .then((result) => {
            if (result === "ok") {
              refresh();

              return;
            }
            Alert.alert(
              "Uncommitted changes",
              `Switching to ${branch} would overwrite local changes.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Stash & switch",
                  onPress: () => run("stash"),
                },
                {
                  text: "Discard & switch",
                  style: "destructive",
                  onPress: () => run("discard"),
                },
              ],
            );
          })
          .catch((err: unknown) => alertError("Couldn't switch branch", err))
          .finally(() => setBusy(null));
      };

      run(dirty);
    },
    [checkoutBranch, refresh, repoRoot, sessionId],
  );

  const remove = useCallback(
    (branch: string, force?: boolean) => {
      const run = (forced?: boolean) => {
        setBusy(branch);
        deleteBranch(sessionId, branch, forced)
          .then((result) => {
            if (result === "ok") {
              refresh();

              return;
            }
            Alert.alert(
              "Unmerged commits",
              `${branch} has commits that aren't merged anywhere. Deleting it loses them.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete anyway",
                  style: "destructive",
                  onPress: () => run(true),
                },
              ],
            );
          })
          .catch((err: unknown) => alertError("Couldn't delete branch", err))
          .finally(() => setBusy(null));
      };

      run(force);
    },
    [deleteBranch, refresh, sessionId],
  );

  const showActions = useCallback(
    (b: RemoteGitBranch) => {
      Alert.alert(b.name, b.is_current ? "Checked out here" : undefined, [
        ...(b.is_current
          ? []
          : [
              {
                text: b.scope === "remote" ? "Check out locally" : "Switch to",
                onPress: () => switchTo(b.name),
              },
            ]),
        ...(b.is_current || b.scope === "remote"
          ? []
          : [
              {
                text: "Delete branch",
                style: "destructive" as const,
                onPress: () =>
                  Alert.alert(`Delete ${b.name}?`, "The branch is removed locally.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => remove(b.name),
                    },
                  ]),
              },
            ]),
        { text: "Cancel", style: "cancel" as const },
      ]);
    },
    [remove, switchTo],
  );

  const { local, remote } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const shown = (branches ?? []).filter((b) =>
      q ? b.name.toLowerCase().includes(q) : true,
    );
    const byName = (a: RemoteGitBranch, b: RemoteGitBranch) =>
      Number(b.is_current) - Number(a.is_current) || a.name.localeCompare(b.name);

    return {
      local: shown.filter((b) => b.scope === "local").sort(byName),
      remote: shown.filter((b) => b.scope === "remote").sort(byName),
    };
  }, [branches, filter]);

  return (
    <Screen>
      <Stack.Screen options={{ title: `Branches · ${label ?? ""}`.trim() }} />

      <NewBranchForm
        sessionId={sessionId}
        repoRoot={repoRoot}
        startPoint={current}
        onCreated={refresh}
      />

      {branches === null ? (
        <Loading label="Loading branches…" />
      ) : branches.length === 0 ? (
        <EmptyState
          icon={<Icons.Branch size={22} color={theme.textMuted} />}
          title="No branches"
          body="This repo has no branches yet — create one above."
        />
      ) : (
        <>
          <TextField
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter branches"
          />

          {local.length > 0 && (
            <SectionHeader count={local.length}>Local</SectionHeader>
          )}
          {local.map((b) => (
            <BranchRow
              key={b.name}
              branch={b}
              busy={busy === b.name}
              onPress={() => (b.is_current ? showActions(b) : switchTo(b.name))}
              onLongPress={() => showActions(b)}
            />
          ))}

          {remote.length > 0 && (
            <SectionHeader count={remote.length}>Remote only</SectionHeader>
          )}
          {remote.map((b) => (
            <BranchRow
              key={`${b.remote}/${b.name}`}
              branch={b}
              busy={busy === b.name}
              onPress={() => switchTo(b.name)}
              onLongPress={() => showActions(b)}
            />
          ))}
        </>
      )}
    </Screen>
  );
}

function alertError(title: string, err: unknown) {
  Alert.alert(title, err instanceof Error ? err.message : String(err));
}

function BranchRow({
  branch,
  busy,
  onPress,
  onLongPress,
}: {
  branch: RemoteGitBranch;
  busy: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const drift = [
    branch.ahead > 0 ? `↑${branch.ahead}` : "",
    branch.behind > 0 ? `↓${branch.behind}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} disabled={busy}>
      <Card style={{ opacity: busy ? 0.5 : 1 }}>
        <Row gap={8}>
          <Icons.Branch
            size={13}
            color={branch.is_current ? theme.accent : theme.textMuted}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Body numberOfLines={1}>{branch.name}</Body>
            {branch.last_commit_subject ? (
              <Muted numberOfLines={1}>{branch.last_commit_subject}</Muted>
            ) : null}
          </View>
          {drift ? <Muted>{drift}</Muted> : null}
          {branch.is_current ? <Badge label="current" tone="accent" /> : null}
          {branch.scope === "remote" && branch.remote ? (
            <Badge label={branch.remote} />
          ) : null}
        </Row>
      </Card>
    </Pressable>
  );
}

/** Create a branch off the current HEAD, checking it out by default. */
function NewBranchForm({
  sessionId,
  repoRoot,
  startPoint,
  onCreated,
}: {
  sessionId: string;
  repoRoot: string;
  startPoint?: string;
  onCreated: () => void;
}) {
  const createBranch = useAppStore((s) => s.createBranch);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    const value = name.trim();
    if (!value || busy) {
      return;
    }
    setBusy(true);
    createBranch(sessionId, repoRoot, value, { checkout, startPoint })
      .then(() => {
        setName("");
        setOpen(false);
        onCreated();
      })
      .catch((err: unknown) => alertError("Couldn't create branch", err))
      .finally(() => setBusy(false));
  };

  if (!open) {
    return <Btn label="New branch" tone="secondary" onPress={() => setOpen(true)} />;
  }

  return (
    <View style={{ gap: 8 }}>
      <TextField
        autoFocus
        value={name}
        onChangeText={setName}
        placeholder="new-branch-name"
        onSubmitEditing={submit}
      />
      <Muted>
        {startPoint ? `Branches off ${startPoint}` : "Branches off the current HEAD"}
      </Muted>
      <Row gap={8}>
        <Btn
          label={checkout ? "Check out after creating" : "Create without switching"}
          size="sm"
          tone="ghost"
          onPress={() => setCheckout((v) => !v)}
        />
      </Row>
      <Row>
        <Btn label="Create" size="sm" disabled={busy || !name.trim()} onPress={submit} />
        <Btn label="Cancel" size="sm" tone="ghost" onPress={() => setOpen(false)} />
      </Row>
    </View>
  );
}
