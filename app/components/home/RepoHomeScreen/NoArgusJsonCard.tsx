import { useState } from "react";
import { Button, CalloutCard, IconBadge, Icons } from "@argus/peacock";
import { suggestArgusJson, writeOnboardingArgusJson } from "../../../lib/ipc";

interface NoArgusJsonCardProps {
  onGenerated: () => void;
  repoRoot: string;
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
    <CalloutCard
      tone="accent"
      leading={
        <IconBadge tone="accent">
          <Icons.GearIcon size={14} />
        </IconBadge>
      }
      title="Finish setting up this project"
      meta={
        error
          ? `Failed to generate: ${error}`
          : "No .argus.json found — Argus needs it to know how to copy files, run commands, and allocate ports when creating sessions."
      }
      actions={
        <Button
          variant="primary"
          size="sm"
          disabled={isGenerating}
          leading={<Icons.PlusIcon size={11} />}
          onClick={handleGenerate}
        >
          {isGenerating ? "Generating…" : "Generate .argus.json"}
        </Button>
      }
    />
  );
}
