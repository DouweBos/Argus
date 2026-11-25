/**
 * New project from a blueprint: check, create the repo, register it with
 * Argus, and start an agent on it.
 *
 * The run record comes back at once and the steps carry on in the background.
 * Nothing is undone on failure: a GitHub repo or folder that already exists
 * stays, and the error names it, because deleting a remote repo is destructive.
 */

import type {
  Blueprint,
  BlueprintRun,
  BlueprintStepKey,
  CreateProjectFromBlueprintInput,
} from "@argus/remote-protocol";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { sendAgentMessage, startAgent } from "../agent/agentService";
import { runClone } from "../clone/run";
import { cloneCommand, parseCloneSource } from "../clone/url";
import { suggestArgusJson, writeArgusJson } from "../onboarding/argusJson";
import { registerProject } from "../onboarding/state";
import { getProjectConfig, saveProjectConfig } from "../session/argusConfig";
import { addRepoRoot, createHeadSession } from "../session/manager";
import { addRelatedProject } from "../session/sessionOps";
import { waitForSessionReady } from "../session/waitForReady";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { runGh, runGit } from "./gh";
import {
  referenceCountBucket,
  requireBlueprint,
  saveBlueprintRun,
} from "./manager";
import { expandHome } from "./paths";
import { buildBlueprintPrompt } from "./prompt";

const STEP_ORDER: BlueprintStepKey[] = [
  "validate",
  "create_repo",
  "register",
  "start_agent",
];

/** GitHub generates a template repo asynchronously; the clone waits for it. */
export const cloneRetry = { attempts: 10, delayMs: 2000 };

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export interface BlueprintPlan {
  blueprint: Blueprint;
  name: string;
  description: string;
  parentDir: string;
  repoRoot: string;
  github: boolean;
  /** Resolved during validation when left empty. */
  owner: string;
  visibility: "private" | "public";
}

/** What exists so far, so a failure can say what it left behind. */
interface Leftovers {
  folder: boolean;
  repoUrl: string | null;
}

export async function createProjectFromBlueprint(
  input: CreateProjectFromBlueprintInput,
): Promise<BlueprintRun> {
  const blueprint = requireBlueprint(input.blueprintId);
  const overrides = input.overrides ?? {};
  const name = input.name.trim();
  const parentDir = expandHome(overrides.parent_dir ?? blueprint.parent_dir);
  const plan: BlueprintPlan = {
    blueprint,
    name,
    description: input.description.trim(),
    parentDir,
    repoRoot: path.join(parentDir, name),
    github: overrides.github_enabled ?? blueprint.github.enabled,
    owner: (overrides.owner ?? blueprint.github.owner).trim(),
    visibility: overrides.visibility ?? blueprint.github.visibility,
  };

  const run: BlueprintRun = {
    id: crypto.randomUUID(),
    blueprint_id: blueprint.id,
    project_name: name,
    repo_root: plan.repoRoot,
    repo_url: null,
    status: "running",
    steps: STEP_ORDER.map((key) => ({ key, status: "pending", error: null })),
    session_id: null,
    agent_id: null,
    started_at: Date.now(),
    finished_at: null,
  };
  saveBlueprintRun(run);
  // The caller has its record; the work reports through `blueprint_run:changed`.
  const done = executeBlueprintRun(run, plan);
  done.catch(() => {});

  return structuredClone(run);
}

/** Exported for tests, which await the whole run. */
export async function executeBlueprintRun(
  run: BlueprintRun,
  plan: BlueprintPlan,
): Promise<BlueprintRun> {
  const left: Leftovers = { folder: false, repoUrl: null };
  let current: BlueprintStepKey = "validate";
  const setStep = (
    key: BlueprintStepKey,
    status: "done" | "failed" | "running",
    error: string | null = null,
  ) => {
    run.steps = run.steps.map((s) =>
      s.key === key ? { ...s, status, error } : s,
    );
    saveBlueprintRun(run);
  };

  try {
    for (const key of STEP_ORDER) {
      current = key;
      setStep(key, "running");
      await STEPS[key](run, plan, left);
      setStep(key, "done");
    }
    run.status = "done";
    run.finished_at = Date.now();
    saveBlueprintRun(run);
    info(`Blueprint project ${plan.name} created at ${plan.repoRoot}`);
    track(plan, true);
  } catch (e) {
    run.status = "failed";
    run.finished_at = Date.now();
    setStep(current, "failed", withLeftovers(errorText(e), left, plan));
    track(plan, false, current);
  }

  return structuredClone(run);
}

type Step = (
  run: BlueprintRun,
  plan: BlueprintPlan,
  left: Leftovers,
) => Promise<void>;

const STEPS: Record<BlueprintStepKey, Step> = {
  validate: async (_run, plan) => validate(plan),
  create_repo: createRepo,
  register: async (run, plan) => register(run, plan),
  start_agent: startProjectAgent,
};

async function validate(plan: BlueprintPlan): Promise<void> {
  if (!NAME_PATTERN.test(plan.name)) {
    throw "Use letters, digits, dots, dashes or underscores for the name, starting with a letter or digit.";
  }
  if (fs.existsSync(plan.repoRoot)) {
    throw `${plan.repoRoot} already exists.`;
  }
  for (const ref of plan.blueprint.references) {
    if (!fs.existsSync(path.join(ref.path, ".git"))) {
      throw `The reference ${ref.path} is not a git repository.`;
    }
  }
  const scaffold = plan.blueprint.scaffold;
  if (!plan.github && scaffold.kind === "empty") {
    return;
  }
  // A template is read through `gh` even when no repo is created.
  await runGh(["auth", "status"], cwdFor(plan));
  if (!plan.github) {
    return;
  }
  if (!plan.owner) {
    plan.owner = await runGh(["api", "user", "--jq", ".login"], cwdFor(plan));
  }
  const taken = await runGh(
    ["repo", "view", `${plan.owner}/${plan.name}`, "--json", "name"],
    cwdFor(plan),
  ).then(
    () => true,
    () => false,
  );
  if (taken) {
    throw `github.com/${plan.owner}/${plan.name} already exists.`;
  }
}

/** `gh` needs a directory that exists; the parent may not yet. */
function cwdFor(plan: BlueprintPlan): string {
  return fs.existsSync(plan.parentDir) ? plan.parentDir : process.cwd();
}

async function createRepo(
  run: BlueprintRun,
  plan: BlueprintPlan,
  left: Leftovers,
): Promise<void> {
  fs.mkdirSync(plan.parentDir, { recursive: true });
  const slug = `${plan.owner}/${plan.name}`;
  const scaffold = plan.blueprint.scaffold;

  if (scaffold.kind === "github_template" && plan.github) {
    await runGh(
      [
        "repo",
        "create",
        slug,
        `--${plan.visibility}`,
        "--template",
        scaffold.repo.trim(),
      ],
      plan.parentDir,
    );
    setRepoUrl(run, left, slug);
    await cloneWithRetry(slug, plan);
    left.folder = true;

    return;
  }

  if (scaffold.kind === "github_template") {
    // No repo of its own: the template's files, without its history.
    await runClone({
      ...cloneCommand(parseCloneSource(scaffold.repo), plan.repoRoot, {
        gh: true,
        depth: 1,
      }),
      dest: plan.repoRoot,
      cwd: plan.parentDir,
    });
    left.folder = true;
    fs.rmSync(path.join(plan.repoRoot, ".git"), {
      recursive: true,
      force: true,
    });
    await runGit(["init", "-b", "main"], plan.repoRoot);
    await runGit(["add", "-A"], plan.repoRoot);
    await runGit(
      ["commit", "-m", `Initial commit from ${scaffold.repo.trim()}`],
      plan.repoRoot,
    );

    return;
  }

  fs.mkdirSync(plan.repoRoot);
  left.folder = true;
  await runGit(["init", "-b", "main"], plan.repoRoot);
  const readme = plan.description
    ? `# ${plan.name}\n\n${plan.description}\n`
    : `# ${plan.name}\n`;
  fs.writeFileSync(path.join(plan.repoRoot, "README.md"), readme);
  await runGit(["add", "README.md"], plan.repoRoot);
  await runGit(["commit", "-m", "Initial commit"], plan.repoRoot);

  if (plan.github) {
    await runGh(
      [
        "repo",
        "create",
        slug,
        `--${plan.visibility}`,
        "--source",
        ".",
        "--push",
      ],
      plan.repoRoot,
    );
    setRepoUrl(run, left, slug);
  }
}

function setRepoUrl(run: BlueprintRun, left: Leftovers, slug: string): void {
  run.repo_url = `https://github.com/${slug}`;
  left.repoUrl = run.repo_url;
  saveBlueprintRun(run);
}

async function cloneWithRetry(
  slug: string,
  plan: BlueprintPlan,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < cloneRetry.attempts; attempt++) {
    try {
      await runClone({
        ...cloneCommand(parseCloneSource(slug), plan.repoRoot, { gh: true }),
        dest: plan.repoRoot,
        cwd: plan.parentDir,
      });

      return;
    } catch (e) {
      lastError = e;
      // A half-made clone would make the next attempt fail on "already exists".
      fs.rmSync(plan.repoRoot, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, cloneRetry.delayMs));
    }
  }
  throw lastError ?? `Could not clone ${slug}.`;
}

function register(run: BlueprintRun, plan: BlueprintPlan): void {
  addRepoRoot(plan.repoRoot);
  registerProject(plan.repoRoot);

  const source = plan.blueprint.copy_project_settings_from;
  if (source && fs.existsSync(source)) {
    const { config } = getProjectConfig(source);
    // Related projects are the reference list, added below with paths from here.
    const { related_projects: _related, ...copied } = config;
    saveProjectConfig(plan.repoRoot, copied, Object.keys(copied));
  } else {
    writeArgusJson(plan.repoRoot, suggestArgusJson(plan.repoRoot).config);
  }
  for (const ref of plan.blueprint.references) {
    addRelatedProject(plan.repoRoot, {
      path: path.relative(plan.repoRoot, ref.path) || ".",
      description: ref.note,
    });
  }

  const session = createHeadSession(plan.repoRoot);
  emitHostEvent("session:created", { ...session });
  run.session_id = session.id;
  saveBlueprintRun(run);
}

async function startProjectAgent(
  run: BlueprintRun,
  plan: BlueprintPlan,
): Promise<void> {
  const sessionId = run.session_id;
  if (!sessionId) {
    throw "The project has no session to start an agent in.";
  }
  await waitForSessionReady(sessionId);

  const agentSettings = plan.blueprint.agent;
  const prompt = buildBlueprintPrompt(plan.blueprint, {
    name: plan.name,
    description: plan.description,
    repoRoot: plan.repoRoot,
    repoUrl: run.repo_url,
  });
  const agent = await startAgent(
    sessionId,
    agentSettings.model ?? undefined,
    agentSettings.permission_mode ?? undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    agentSettings.runner ?? undefined,
  );
  // Backend-started agents are invisible to clients without this.
  emitHostEvent("agent:started", {
    agent_id: agent.agent_id,
    session_id: agent.session_id,
    status: agent.status,
    parent_agent_id: agent.parent_agent_id,
    created_at: agent.created_at,
    initial_prompt: prompt,
    model: agent.model,
  });
  sendAgentMessage(agent.agent_id, prompt);
  emitHostEvent(`agent:remote-message:${agent.agent_id}`, {
    message: prompt,
    author: "Blueprint",
  });
  run.agent_id = agent.agent_id;
  saveBlueprintRun(run);
}

function errorText(e: unknown): string {
  if (typeof e === "string") {
    return e;
  }

  return e instanceof Error ? e.message : String(e);
}

function withLeftovers(
  message: string,
  left: Leftovers,
  plan: BlueprintPlan,
): string {
  const kept: string[] = [];
  if (left.repoUrl) {
    kept.push(`the repository ${left.repoUrl}`);
  }
  if (left.folder) {
    kept.push(`the folder ${plan.repoRoot}`);
  }

  return kept.length > 0
    ? `${message} ${capitalize(kept.join(" and "))} ${kept.length > 1 ? "were" : "was"} already created and left in place.`
    : message;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function track(
  plan: BlueprintPlan,
  success: boolean,
  failed?: BlueprintStepKey,
): void {
  telemetryCapture("blueprint_project_created", {
    scaffold: plan.blueprint.scaffold.kind,
    github: plan.github,
    visibility: plan.visibility,
    reference_count_bucket: referenceCountBucket(
      plan.blueprint.references.length,
    ),
    success,
    ...(failed ? { failed_step: failed } : {}),
  });
}
