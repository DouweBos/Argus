import { useState } from "react";
import { Icons } from "@argus/peacock";
import {
  suggestArgusJson,
  writeOnboardingArgusJson,
} from "../../../lib/ipc";
import styles from "./NoArgusJsonCard.module.css";

interface NoArgusJsonCardProps {
  repoRoot: string;
  onGenerated: () => void;
}

export function NoArgusJsonCard({
  repoRoot,
  onGenerated,
}: NoArgusJsonCardProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const suggestion = await suggestArgusJson(repoRoot);
      await writeOnboardingArgusJson(
        repoRoot,
        suggestion.config as Record<string, unknown>,
      );
      onGenerated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsGenerating(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <div className={styles.iconWrap}>
          <Icons.GearIcon size={14} />
        </div>
        <div className={styles.body}>
          <div className={styles.title}>Finish setting up this project</div>
          <div className={styles.meta}>
            {error
              ? `Failed to generate: ${error}`
              : "No .argus.json found — Argus needs it to know how to copy files, run commands, and allocate ports when creating sessions."}
          </div>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.primaryBtn}
            disabled={isGenerating}
            type="button"
            onClick={handleGenerate}
          >
            <Icons.PlusIcon size={11} />
            {isGenerating ? "Generating\u2026" : "Generate .argus.json"}
          </button>
        </div>
      </div>
    </div>
  );
}
