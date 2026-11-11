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

export class DoneGate {
  /** Order of tool calls; 0 means never. */
  private seq = 0;
  private lastEdit = 0;
  private lastEvidence = 0;
  private editedSinceEvidence = new Set<string>();
  private blockedThisTurn = false;
  private pendingBlockAt: number | null = null;

  constructor(private readonly opts: DoneGateOptions) {}

  /** Feed a raw stream-json stdout line; picks out tool calls, subagents' included. */
  observeLine(line: string): void {
    if (!line.includes('"tool_use"') || !line.includes('"assistant"')) {
      return;
    }
    let parsed: { type?: string; message?: { content?: unknown } };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return;
    }
    const content = parsed.message?.content;
    if (parsed.type !== "assistant" || !Array.isArray(content)) {
      return;
    }
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "tool_use" && typeof block.name === "string") {
        this.observeToolUse(
          block.name,
          (block.input as Record<string, unknown> | undefined) ?? {},
        );
      }
    }
  }

  observeToolUse(name: string, input: Record<string, unknown>): void {
    const kind = classifyToolUse(name, input);
    if (!kind) {
      return;
    }
    this.seq += 1;
    if (kind === "evidence") {
      this.lastEvidence = this.seq;
      this.editedSinceEvidence.clear();

      return;
    }
    this.lastEdit = this.seq;
    const path = input.file_path ?? input.notebook_path;
    if (typeof path === "string") {
      this.editedSinceEvidence.add(path.split("/").pop() ?? path);
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
      this.lastEvidence === 0 ||
      this.lastEdit <= this.lastEvidence ||
      !this.opts.enabled()
    ) {
      return null;
    }
    this.blockedThisTurn = true;
    this.pendingBlockAt = this.seq;

    return blockReason([...this.editedSinceEvidence]);
  }

  dispose(): void {
    this.resolvePending();
  }

  private resolvePending(): void {
    if (this.pendingBlockAt === null) {
      return;
    }
    const reverified = this.lastEvidence > this.pendingBlockAt;
    this.pendingBlockAt = null;
    this.opts.report(reverified);
  }
}

function blockReason(files: string[]): string {
  const shown = files.slice(0, 3).join(", ");
  const more = files.length > 3 ? ` and ${files.length - 3} more` : "";
  const what = shown ? ` (${shown}${more})` : "";

  return (
    `You edited code${what} after your last verification, so your evidence ` +
    "predates the final code. Re-verify the changed behaviour in the running app " +
    "(screenshot, design_compare or the checks you ran) and refresh your report's " +
    "evidence before finishing."
  );
}
