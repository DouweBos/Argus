/**
 * Commit, push and merge a session's branch from the Changes screen — Peacock's
 * `LandWorkCard` over the gateway. Control only; the computer still refuses a
 * protected base or a conflicting merge, and the card says why up front.
 */

import { useCallback, useEffect, useState } from "react";
import {
  baseBranchLabel,
  changeSummary,
  commitIdentityLabel,
  type CommitMessage,
  describeError,
  EMPTY_COMMIT_MESSAGE,
  isCommitMessageEmpty,
  mergedNote,
  parseCommitMessage,
  pushLabel,
} from "@argus/client-core";
import {
  CommitForm,
  type CommitComposerCommit,
  type CommitComposerFile,
  type CommitFormOptions,
  type LandWorkBusy,
  LandWorkCard,
} from "@argus/peacock";
import { useGitStore } from "../../stores/git";
import {
  type CommitIdentity,
  commitIdentity,
  commitWork,
  lastCommit,
  mergeBlockers,
  mergeIntoBase,
  pushWork,
  recentCommits,
  setBaseBranch,
} from "../../stores/land";
import { useHeldSession } from "../start/useHeldSession";
import { BaseBranchDialog, MergeIntoBaseDialog } from "./LandWorkDialogs";
import { OpenPullRequest } from "./OpenPullRequest";

const NO_OPTIONS: CommitFormOptions = {
  amend: false,
  signOff: false,
  sign: false,
};

export function LandWork({
  files,
  onChanged,
  sessionId,
}: {
  /** The changed files, for the composer's backslash completions. */
  files: CommitComposerFile[];
  /** Anything that changed the tree: the diff reloads. */
  onChanged: () => void;
  sessionId: string;
}) {
  const status = useGitStore((s) => s.gitStatusBySession[sessionId]);
  const session = useHeldSession(sessionId);
  const [busy, setBusy] = useState<LandWorkBusy>(null);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(
    null,
  );
  const [blockers, setBlockers] = useState<string[]>([]);
  const [message, setMessage] = useState<CommitMessage>(EMPTY_COMMIT_MESSAGE);
  const [draftBeforeAmend, setDraftBeforeAmend] =
    useState<CommitMessage | null>(null);
  const [options, setOptions] = useState<CommitFormOptions>(NO_OPTIONS);
  const [identity, setIdentity] = useState<CommitIdentity | null>(null);
  const [recent, setRecent] = useState<CommitComposerCommit[]>([]);
  const [asking, setAsking] = useState<"base" | "merge" | "pr" | null>(null);
  const dirty = status?.dirty_count ?? 0;
  const base = session?.base_branch;

  const refreshBlockers = useCallback(() => {
    void mergeBlockers(sessionId).then(setBlockers);
  }, [sessionId]);

  useEffect(refreshBlockers, [refreshBlockers, dirty, base]);

  useEffect(() => {
    void commitIdentity(sessionId).then(setIdentity);
    void recentCommits(sessionId).then((list) =>
      setRecent(
        list.map((c) => ({ subject: c.subject, abbreviatedHash: c.short_hash })),
      ),
    );
  }, [sessionId]);

  const finish = () => {
    refreshBlockers();
    onChanged();
  };

  async function attempt(
    kind: Exclude<LandWorkBusy, null>,
    call: () => Promise<string>,
  ) {
    setBusy(kind);
    setNote(null);
    try {
      setNote({ error: false, text: await call() });
    } catch (err) {
      setNote({ error: true, text: describeError(err) });
    } finally {
      setBusy(null);
      finish();
    }
  }

  /** Amend starts from the last commit's message, as git's editor would. */
  const setAmend = (amend: boolean) => {
    setOptions((o) => ({ ...o, amend }));
    if (amend) {
      const draft = message;
      setDraftBeforeAmend(draft);
      void lastCommit(sessionId).then((last) => {
        if (last) {
          setMessage((now) =>
            now === draft
              ? parseCommitMessage(
                  last.body ? `${last.subject}\n\n${last.body}` : last.subject,
                )
              : now,
          );
        }
      });
    } else if (draftBeforeAmend) {
      setMessage(draftBeforeAmend);
      setDraftBeforeAmend(null);
    }
  };

  const commit = () =>
    attempt("commit", async () => {
      const amending = options.amend;
      await commitWork(sessionId, message, options);
      setMessage(EMPTY_COMMIT_MESSAGE);
      setDraftBeforeAmend(null);
      setOptions((o) => ({ ...o, amend: false }));

      return amending ? "Amended the last commit." : "Committed.";
    });

  const push = () =>
    attempt("push", async () => {
      const result = await pushWork(sessionId);

      return `Pushed ${result.branch} to ${result.remote}.`;
    });

  const branch = status?.branch ?? session?.branch ?? "branch";

  return (
    <>
      <LandWorkCard
        branch={branch}
        base={baseBranchLabel(base)}
        onChangeBase={() => setAsking("base")}
        note={
          note && (
            <span className={note.error ? "aw-ship-error" : undefined}>
              {note.text}
            </span>
          )
        }
        clean={dirty === 0}
        blockers={blockers}
        pushLabel={pushLabel(status?.ahead)}
        onPush={() => void push()}
        onOpenPullRequest={session ? () => setAsking("pr") : undefined}
        onMerge={() => setAsking("merge")}
        busy={busy}
      >
        <CommitForm
          summary={message.summary}
          description={message.description}
          onSummaryChange={(summary) => setMessage((m) => ({ ...m, summary }))}
          onDescriptionChange={(description) =>
            setMessage((m) => ({ ...m, description }))
          }
          options={options}
          onOptionsChange={setOptions}
          onAmendChange={setAmend}
          allowsAmend
          canSign={identity?.can_sign ?? false}
          identity={identity ? commitIdentityLabel(identity) : null}
          changeSummary={status ? changeSummary(status) : ""}
          committing={busy === "commit"}
          disabled={busy !== null}
          onCommit={() => {
            if (!isCommitMessageEmpty(message)) {
              void commit();
            }
          }}
          recentCommits={recent}
          diffFiles={files}
        />
      </LandWorkCard>

      {asking === "merge" && (
        <MergeIntoBaseDialog
          base={base}
          onCancel={() => setAsking(null)}
          onPick={(strategy) => {
            setAsking(null);
            void attempt("merge", async () => {
              await mergeIntoBase(sessionId, strategy);

              return mergedNote(strategy, baseBranchLabel(base));
            });
          }}
        />
      )}
      {asking === "base" && (
        <BaseBranchDialog
          sessionId={sessionId}
          current={base}
          onCancel={() => setAsking(null)}
          onPick={(picked) => {
            setAsking(null);
            setBusy("base");
            setBaseBranch(sessionId, session?.repo_root ?? null, picked)
              .then(() =>
                setNote({ error: false, text: `Base branch is now ${picked}.` }),
              )
              .catch((err: unknown) =>
                setNote({ error: true, text: describeError(err) }),
              )
              .finally(() => {
                setBusy(null);
                finish();
              });
          }}
        />
      )}
      {asking === "pr" && session && (
        <OpenPullRequest
          session={session}
          onClose={() => setAsking(null)}
          onOpened={(url) => setNote({ error: false, text: `Opened ${url}` })}
        />
      )}
    </>
  );
}
