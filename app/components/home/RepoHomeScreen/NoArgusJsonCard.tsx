import { useState } from "react";
import { Button, CalloutCard, IconBadge, Icons } from "@argus/peacock";
import {
  refineArgusJsonWithClaude,
  suggestArgusJson,
  writeOnboardingArgusJson,
} from "../../../lib/ipc";
import { Dialog, dialogStyles as styles } from "../../shared/Dialog";

interface NoArgusJsonCardProps {
  onGenerated: () => void;
  repoRoot: string;
}

type Mode = "choosing" | "generating-claude" | "generating-quick" | "idle";

export function NoArgusJsonCard({
  repoRoot,
  onGenerated,
}: NoArgusJsonCardProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setError(null);
    setMode("choosing");
  };
  const close = () => {
    if (mode === "generating-quick" || mode === "generating-claude") {
      return;
    }
    setMode("idle");
    setError(null);
  };

  const runQuick = async () => {
    setMode("generating-quick");
    setError(null);
    try {
      const suggestion = await suggestArgusJson(repoRoot);
      await writeOnboardingArgusJson(
        repoRoot,
        suggestion.config as Record<string, unknown>,
      );
      setMode("idle");
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMode("choosing");
    }
  };

  const runClaude = async () => {
    setMode("generating-claude");
    setError(null);
    try {
      const suggestion = await suggestArgusJson(repoRoot);
      const refined = await refineArgusJsonWithClaude(
        repoRoot,
        suggestion.config as Record<string, unknown>,
      );
      await writeOnboardingArgusJson(repoRoot, refined);
      setMode("idle");
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMode("choosing");
    }
  };

  const isGenerating =
    mode === "generating-quick" || mode === "generating-claude";

  return (
    <>
      <CalloutCard
        tone="accent"
        leading={
          <IconBadge tone="accent">
            <Icons.GearIcon size={14} />
          </IconBadge>
        }
        title="Finish setting up this project"
        meta="No .argus.json found — Argus needs it to know how to copy files, run commands, and allocate ports when creating sessions."
        actions={
          <Button
            variant="primary"
            size="sm"
            leading={<Icons.PlusIcon size={11} />}
            onClick={open}
          >
            Generate .argus.json
          </Button>
        }
      />

      {mode !== "idle" && (
        <Dialog
          title="Generate .argus.json"
          titleId="generate-argus-json-title"
          onClose={close}
          size="medium"
        >
          <div className={styles.form}>
            <p className={styles.helpText}>
              An <code>.argus.json</code> file tells Argus how to set up new
              worktrees for this project — which directories to copy (
              <code>node_modules</code>, <code>Pods</code>), which files to
              symlink (<code>.env</code>), which install commands to run, and
              which ports to allocate per session. It&apos;s checked in so the
              whole team shares the same setup.
            </p>

            <div className={styles.field}>
              <label className={styles.label}>Quick generate</label>
              <p className={styles.helpText}>
                Inspect <code>package.json</code>, lockfiles, and platform dirs
                and write a sensible default. Fast, no network, no LLM.
              </p>
              <Button
                variant="secondary"
                disabled={isGenerating}
                onClick={runQuick}
              >
                {mode === "generating-quick" ? "Generating…" : "Quick generate"}
              </Button>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Generate with Claude</label>
              <p className={styles.helpText}>
                Run the Claude CLI in this project to refine the config — it
                reads your scripts, native targets, and env files and produces a
                tailored result. Takes ~30–90s. Requires the <code>claude</code>{" "}
                CLI to be installed and authenticated.
              </p>
              <Button
                variant="primary"
                disabled={isGenerating}
                onClick={runClaude}
                leading={<Icons.AgentStartIcon size={12} />}
              >
                {mode === "generating-claude"
                  ? "Asking Claude…"
                  : "Generate with Claude"}
              </Button>
            </div>

            {error && <p className={styles.errorMsg}>{error}</p>}

            <div className={styles.footer}>
              <Button variant="ghost" disabled={isGenerating} onClick={close}>
                Cancel
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
