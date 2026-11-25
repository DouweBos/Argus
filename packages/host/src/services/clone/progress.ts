/** `git clone --progress` stderr, as a phase and a percent. */

import type { ClonePhase } from "@argus/remote-protocol";

export interface CloneProgress {
  phase: ClonePhase;
  percent: number | null;
}

const PHASES: [RegExp, ClonePhase][] = [
  [/counting objects/i, "counting"],
  [/compressing objects/i, "compressing"],
  [/receiving objects/i, "receiving"],
  [/resolving deltas/i, "resolving"],
  [/(updating files|checking out files)/i, "checking_out"],
  [/enumerating objects/i, "counting"],
];

/** One progress line (`remote: Counting objects:  45% (9/20)`), or null. */
export function parseProgressLine(line: string): CloneProgress | null {
  for (const [pattern, phase] of PHASES) {
    if (!pattern.test(line)) {
      continue;
    }
    const percent = /(\d{1,3})%/.exec(line);

    return {
      phase,
      percent: percent ? Math.min(100, Number(percent[1])) : null,
    };
  }

  return null;
}

/**
 * Git redraws a progress line with `\r` and ends it with `\n`, and a chunk can
 * stop mid-line. Feed chunks in; it reports each completed line's progress and
 * keeps the rest of the stderr for an error message.
 */
export class CloneProgressReader {
  private pending = "";
  private readonly other: string[] = [];

  constructor(private readonly onProgress: (p: CloneProgress) => void) {}

  push(chunk: string): void {
    const text = this.pending + chunk;
    const parts = text.split(/\r\n|\r|\n/);
    this.pending = parts.pop() ?? "";
    for (const part of parts) {
      this.line(part);
    }
  }

  /** Flush the last unterminated line. */
  end(): void {
    if (this.pending) {
      this.line(this.pending);
      this.pending = "";
    }
  }

  /** Non-progress stderr lines, oldest first (capped). */
  get messages(): string[] {
    return this.other;
  }

  private line(raw: string): void {
    const line = raw.trim();
    if (!line) {
      return;
    }
    const progress = parseProgressLine(line);
    if (progress) {
      this.onProgress(progress);

      return;
    }
    this.other.push(line);
    if (this.other.length > 40) {
      this.other.shift();
    }
  }
}

/** The line worth showing from a failed clone's stderr. */
export function cloneFailureMessage(lines: string[]): string {
  const text = lines.join("\n");
  if (/repository .* not found|not found/i.test(text)) {
    return "Repository not found, or you don't have access to it.";
  }
  if (/permission denied \(publickey\)/i.test(text)) {
    return "The ssh key was refused. Add your key to the git host, or clone over https.";
  }
  if (
    /authentication failed|could not read username|terminal prompts disabled/i.test(
      text,
    )
  ) {
    return "The git host asked for credentials. Sign in with gh auth login or set up a credential helper.";
  }
  if (/host key verification failed/i.test(text)) {
    return "The ssh host key isn't trusted yet. Connect once with ssh in a terminal to accept it.";
  }
  if (/could not resolve host/i.test(text)) {
    return "Couldn't reach the git host. Check the address and your connection.";
  }
  const fatal = [...lines].reverse().find((l) => /^(fatal|error):/i.test(l));

  return (fatal ?? lines.at(-1) ?? "The clone failed.").replace(
    /^(fatal|error):\s*/i,
    "",
  );
}
