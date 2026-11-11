/**
 * Stop gate: an agent that verified its work and then edited code again must
 * re-verify before it may finish. See "Verify before finishing" in
 * `docs/app-settings.md` for the rule.
 */

export type ToolUseKind = "edit" | "evidence";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit", "Write"]);

/** Files whose edits don't change the app's behaviour. */
const NON_SOURCE = /(\.(md|mdx|txt)$)|(^|\/)(\.changeset|plan)\//i;

const CONDUCTOR_EVIDENCE = new Set([
  "capture-ui",
  "inspect",
  "take-screenshot",
]);

/** Binaries that are themselves a test, lint or type check. */
const CHECK_BINARIES = new Set([
  "eslint",
  "jest",
  "maestro",
  "playwright",
  "pytest",
  "rspec",
  "swiftlint",
  "tsc",
  "vitest",
]);

/** Package runners whose script/subcommand name decides. */
const RUNNERS = new Set([
  "bun",
  "bunx",
  "cargo",
  "go",
  "make",
  "mise",
  "npm",
  "npx",
  "pnpm",
  "swift",
  "uv",
  "yarn",
]);

const CHECK_SCRIPT =
  /^(check|e2e|eslint|jest|lint|test|tsc|typecheck|type-check|vitest)([:-].*)?$/;

/** What a tool call counts as for the gate, or `null` when neither. */
export function classifyToolUse(
  name: string,
  input: Record<string, unknown>,
): ToolUseKind | null {
  if (EDIT_TOOLS.has(name)) {
    const path = input.file_path ?? input.notebook_path;

    return typeof path === "string" && NON_SOURCE.test(path) ? null : "edit";
  }
  if (name.endsWith("__design_compare")) {
    return "evidence";
  }
  if (name === "Bash" && typeof input.command === "string") {
    return isEvidenceCommand(input.command) ? "evidence" : null;
  }

  return null;
}

/** A shell command that screenshots/inspects the app or runs a check. */
export function isEvidenceCommand(command: string): boolean {
  return command
    .split(/&&|\|\||[;|\n]/)
    .some((segment) => isEvidenceSegment(words(segment)));
}

function words(segment: string): string[] {
  const all = segment.trim().split(/\s+/).filter(Boolean);
  // Leading `FOO=bar` env assignments.
  while (all[0] && /^[A-Z_][A-Z0-9_]*=/.test(all[0])) {
    all.shift();
  }

  return all;
}

function isEvidenceSegment(argv: string[]): boolean {
  const bin = argv[0]?.split("/").pop();
  if (!bin) {
    return false;
  }
  const args = argv.slice(1).filter((a) => !a.startsWith("-"));
  if (bin === "conductor") {
    return args.some((a) => CONDUCTOR_EVIDENCE.has(a));
  }
  if (bin === "xcodebuild") {
    return args.includes("test");
  }
  if (CHECK_BINARIES.has(bin)) {
    return true;
  }
  if (RUNNERS.has(bin)) {
    // `pnpm -F host test`, `npm run lint`, `swift test`, `npx tsc`.
    return args.slice(0, 4).some((a) => CHECK_SCRIPT.test(a));
  }

  return false;
}

export interface DoneGateOptions {
  /** Read on every stop, so the setting applies to running agents. */
  enabled: () => boolean;
  /** A block resolved: the agent stopped again, got a new message, or exited. */
  report: (reverified: boolean) => void;
}

/** One agent's own ledger: the main agent or a subagent. */
interface Actor {
  /** File name → seq of its newest edit not yet covered by evidence. */
  edits: Map<string, number>;
  lastEvidence: number;
}

/** A subagent launched with the Agent/Task tool, until it finishes. */
interface SubagentCall {
  background: boolean;
  /** The actor that launched it; `null` is the main agent. */
  parent: string | null;
}

const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

interface StreamLine {
  is_backgrounded?: boolean;
  message?: { content?: unknown };
  parent_tool_use_id?: string | null;
  subtype?: string;
  tool_use_id?: string;
  type?: string;
}

/**
 * Edits and evidence are kept per actor. A subagent's edits reach the actor
 * that launched it only once it finishes, and only those it didn't verify
 * itself; they then need evidence gathered after that point. Edits by
 * subagents still running never block a stop.
 */
export class DoneGate {
  /** Order of tool calls and subagent finishes; 0 means never. */
  private seq = 0;
  /** Any evidence by anyone, ever: arms the gate. */
  private armed = false;
  private readonly main: Actor = newActor();
  /** Subagents by the tool_use id their lines carry as `parent_tool_use_id`. */
  private readonly subagents = new Map<string, Actor>();
  private readonly calls = new Map<string, SubagentCall>();
  private blockedThisTurn = false;
  private pendingBlockAt: number | null = null;

  constructor(private readonly opts: DoneGateOptions) {}

  /** Feed a raw stream-json stdout line: tool calls, results and task events. */
  observeLine(line: string): void {
    const relevant =
      line.includes('"tool_use"') ||
      (this.calls.size > 0 &&
        (line.includes('"tool_result"') || line.includes('"task_')));
    if (!relevant) {
      return;
    }
    let parsed: StreamLine;
    try {
      parsed = JSON.parse(line) as StreamLine;
    } catch {
      return;
    }
    if (parsed.type === "system") {
      this.observeTaskEvent(parsed);

      return;
    }
    const content = parsed.message?.content;
    if (!Array.isArray(content)) {
      return;
    }
    const actor = parsed.parent_tool_use_id ?? null;
    for (const block of content as Record<string, unknown>[]) {
      if (parsed.type === "assistant" && block.type === "tool_use") {
        if (typeof block.name === "string") {
          this.observeToolUse(
            block.name,
            (block.input as Record<string, unknown> | undefined) ?? {},
            actor,
            typeof block.id === "string" ? block.id : undefined,
          );
        }
      } else if (
        parsed.type === "user" &&
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string" &&
        this.calls.get(block.tool_use_id)?.background === false
      ) {
        this.finishSubagent(block.tool_use_id);
      }
    }
  }

  /** A tool call by `actor` (`null` for the main agent, else the subagent's launch id). */
  observeToolUse(
    name: string,
    input: Record<string, unknown>,
    actor: string | null = null,
    id?: string,
  ): void {
    if (id && SUBAGENT_TOOLS.has(name)) {
      this.calls.set(id, {
        background: input.run_in_background === true,
        parent: actor,
      });
    }
    const kind = classifyToolUse(name, input);
    if (!kind) {
      return;
    }
    this.seq += 1;
    const ledger = this.actor(actor);
    if (kind === "evidence") {
      this.armed = true;
      ledger.lastEvidence = this.seq;
      ledger.edits.clear();

      return;
    }
    const path = input.file_path ?? input.notebook_path;
    const file =
      typeof path === "string" ? (path.split("/").pop() ?? path) : "";
    ledger.edits.set(file, this.seq);
  }

  /** A subagent's call returned (foreground) or its task settled (background). */
  finishSubagent(id: string): void {
    const call = this.calls.get(id);
    this.calls.delete(id);
    const child = this.subagents.get(id);
    this.subagents.delete(id);
    if (!child) {
      return;
    }
    const parent = this.actor(call?.parent ?? null);
    // Its checks ran on the shared tree, so they cover the launcher's older edits.
    if (child.lastEvidence > parent.lastEvidence) {
      parent.lastEvidence = child.lastEvidence;
      for (const [file, at] of parent.edits) {
        if (at < child.lastEvidence) {
          parent.edits.delete(file);
        }
      }
    }
    if (child.edits.size === 0) {
      return;
    }
    this.seq += 1;
    for (const file of child.edits.keys()) {
      parent.edits.set(file, this.seq);
    }
  }

  /** A user message went in: a new turn may be blocked once again. */
  newTurn(): void {
    this.resolvePending();
    this.blockedThisTurn = false;
  }

  /** Answer the `Stop` hook: a reason to keep going, or `null` to let it stop. */
  onStop(stopHookActive: boolean): string | null {
    this.resolvePending();
    if (
      stopHookActive ||
      this.blockedThisTurn ||
      !this.armed ||
      this.main.edits.size === 0 ||
      !this.opts.enabled()
    ) {
      return null;
    }
    this.blockedThisTurn = true;
    this.pendingBlockAt = this.seq;

    return blockReason([...this.main.edits.keys()].filter(Boolean));
  }

  dispose(): void {
    this.resolvePending();
  }

  private observeTaskEvent(event: StreamLine): void {
    const id = event.tool_use_id;
    const call = id ? this.calls.get(id) : undefined;
    if (!id || !call) {
      return;
    }
    if (event.subtype === "task_started" && event.is_backgrounded) {
      call.background = true;
    } else if (event.subtype === "task_notification") {
      this.finishSubagent(id);
    }
  }

  private actor(id: string | null): Actor {
    if (id === null) {
      return this.main;
    }
    let actor = this.subagents.get(id);
    if (!actor) {
      actor = newActor();
      this.subagents.set(id, actor);
    }

    return actor;
  }

  private resolvePending(): void {
    if (this.pendingBlockAt === null) {
      return;
    }
    const reverified = this.main.lastEvidence > this.pendingBlockAt;
    this.pendingBlockAt = null;
    this.opts.report(reverified);
  }
}

function newActor(): Actor {
  return { edits: new Map(), lastEvidence: 0 };
}

function blockReason(files: string[]): string {
  const shown = files.slice(0, 3).join(", ");
  const more = files.length > 3 ? ` and ${files.length - 3} more` : "";
  const what = shown ? ` (${shown}${more})` : "";

  return (
    `Code changed${what} after your last verification, by you or by a ` +
    "subagent that finished without verifying it, so your evidence " +
    "predates the final code. Re-verify the changed behaviour in the running app " +
    "(screenshot, design_compare or the checks you ran) and refresh your report's " +
    "evidence before finishing."
  );
}
