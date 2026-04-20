import type { ExampleProject } from "../../lib/types";
import { useEffect, useState } from "react";
import { Button, FormField, Input, SegmentedCard } from "@argus/peacock";
import { useOnboarding } from "../../hooks/useOnboarding";
import {
  cloneOnboardingExample,
  listOnboardingExamples,
  registerOnboardingProject,
} from "../../lib/ipc";
import { setProjectPath } from "../../stores/onboardingStore";
import { OnboardingLayout } from "./OnboardingLayout";

type Tab = "clone" | "example" | "existing";

export function ProjectPickerStep() {
  const { advance } = useOnboarding();
  const [tab, setTab] = useState<Tab>("existing");
  const [path, setPath] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [examples, setExamples] = useState<ExampleProject[]>([]);
  const [selectedExample, setSelectedExample] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listOnboardingExamples()
      .then(setExamples)
      .catch(() => {
        /* noop */
      });
  }, []);

  const pickFolder = async () => {
    try {
      const r = await window.argus.invoke<string | null>("show_open_dialog");
      if (r) {
        setPath(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let resolved: string | null = null;
      if (tab === "existing") {
        if (!path) {
          throw new Error("Pick a project folder first");
        }
        resolved = path;
      } else if (tab === "clone") {
        throw new Error("Clone not yet supported in this onboarding build");
      } else if (tab === "example") {
        if (!selectedExample) {
          throw new Error("Pick an example");
        }
        const r = await cloneOnboardingExample(selectedExample);
        resolved = r.path;
      }
      if (!resolved) {
        throw new Error("No project resolved");
      }
      await registerOnboardingProject(resolved);
      setProjectPath(resolved);
      await advance("argus_config");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingLayout
      currentStep="project"
      title="Pick your first project"
      subtitle="Argus needs a git repo to work in. Open an existing one, clone a URL, or start from a curated example."
      footerRight={
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            submit().catch(() => {});
          }}
        >
          {busy ? "Working…" : "Continue"}
        </Button>
      }
    >
      <div style={{ display: "flex", gap: 8 }}>
        {(
          [
            { id: "existing", label: "Open existing" },
            { id: "clone", label: "Clone from Git" },
            { id: "example", label: "Try an example" },
          ] as const
        ).map(({ id, label }) => (
          <Button
            key={id}
            variant={tab === id ? "primary" : "ghost"}
            size="sm"
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>
      {tab === "existing" ? (
        <FormField label="Project folder">
          <div style={{ display: "flex", gap: 8 }}>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/Users/you/code/my-repo"
              style={{ flex: 1 }}
            />
            <Button
              variant="secondary"
              onClick={() => {
                pickFolder().catch(() => {});
              }}
            >
              Browse…
            </Button>
          </div>
        </FormField>
      ) : null}
      {tab === "clone" ? (
        <FormField label="Repository URL" helper="Coming soon.">
          <Input
            value={cloneUrl}
            onChange={(e) => setCloneUrl(e.target.value)}
            placeholder="https://github.com/you/repo.git"
            disabled
          />
        </FormField>
      ) : null}
      {tab === "example" ? (
        <div
          style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}
        >
          {examples.map((ex) => (
            <SegmentedCard
              key={ex.slug}
              title={ex.name}
              description={ex.description}
              selected={selectedExample === ex.slug}
              onClick={() => setSelectedExample(ex.slug)}
            />
          ))}
        </div>
      ) : null}
      {error ? (
        <div style={{ color: "var(--error)", fontSize: 12 }}>{error}</div>
      ) : null}
    </OnboardingLayout>
  );
}
