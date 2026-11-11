/**
 * `/implement-ticket <ticket>`: the validation loop an agent runs on a ticket —
 * read it, pull every design up front, baseline, implement, drive each
 * acceptance criterion on every device, compare with Figma, run the checks,
 * repeat until a full pass follows the last code change, then report.
 */

import type { VerifyConfig } from "../../session/models";

export const VERIFY_DIR = ".argus/verify";

export interface ImplementTicketInput {
  /** `ENG-123` or an issue URL; empty when the user left it out. */
  ticket: string;
  /** Whatever the user typed after the ticket. */
  extra: string;
  verify: VerifyConfig | null;
  /** Titles of the project's configured run commands. */
  runCommands: string[];
}

/** `ENG-123` from an identifier or a Linear URL; anything else made path-safe. */
export function ticketKey(ticket: string): string {
  const id = /[A-Za-z][A-Za-z0-9]*-\d+/.exec(ticket)?.[0];

  return (id ?? ticket).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
}

function code(text: string): string {
  return `\`${text.replace(/`/g, "'")}\``;
}

function devicesStep(
  verify: VerifyConfig | null,
  runCommands: string[],
  key: string,
): string {
  const list = `From the ticket and the frames, decide which platforms and form factors the change affects — only what the ticket touches (a layout change on iOS that also ships on iPad: a phone and a tablet). Verify on the device(s) already reserved for or handed to you (\`conductor workspace info\`). For each other form factor, create a fresh throwaway device: \`conductor start-device --platform <p> --device-type "<type>" --name "${key}-<form factor>"\`. Never use another agent's or the user's devices, and never boot an existing device by name. Shut down the throwaways you created with \`conductor stop-device <id>\` when you're done.`;
  const run =
    runCommands.length > 0
      ? `Start the app with \`trigger_run\` (configured: ${runCommands.map(code).join(", ")}) and wait for it with \`wait_for_terminal\` — never from Bash.`
      : "Start the app with `list_run_commands` / `trigger_run`, never from Bash.";
  const verb = verify?.sign_in?.startsWith("/") ? "invoking" : "running";
  const signIn = verify?.sign_in
    ? `Sign in on each device by ${verb} ${code(verify.sign_in)}.`
    : "If the app needs an account, sign in through its UI with conductor.";

  return `${list} ${run} ${signIn}`;
}

function baselineStep(verify: VerifyConfig | null, dir: string): string {
  if (verify?.baseline === false) {
    return "Baselines are off for this project; skip to the next step.";
  }

  return `Before changing any code, screenshot every screen the ticket touches on every device: \`conductor take-screenshot --device <id> --output ${dir}/baseline/<device>-<screen>.png\`. These show what changed and what must not.`;
}

function loadingCheck(verify: VerifyConfig | null): string {
  if (!verify?.slow_backend) {
    return "";
  }

  return `\n- Loading states: slow the backend with ${code(verify.slow_backend)}, then open every affected tab or screen fresh and check its first load (placeholder or spinner, no layout jump, no error flash). Restore the backend afterwards.`;
}

function checksStep(verify: VerifyConfig | null): string {
  const checks = verify?.checks ?? [];
  if (checks.length === 0) {
    return "This project lists no checks: run its type-check, lint and unit tests (see `package.json` scripts or the build files) and any end-to-end flows it has. Every one must pass.";
  }

  return `Run each from the worktree root; every one must pass:\n${checks.map((c) => `- ${code(c)}`).join("\n")}`;
}

/** The prompt `/implement-ticket` expands to. */
export function implementTicketPrompt(input: ImplementTicketInput): string {
  const { ticket, extra, verify, runCommands } = input;
  if (!ticket) {
    return "The user ran `/implement-ticket` without a ticket. Ask which Linear issue (e.g. ENG-123 or its URL) to implement, then run `/implement-ticket` on it.";
  }
  const dir = `${VERIFY_DIR}/${ticketKey(ticket)}`;
  const noVerify = verify
    ? ""
    : "\n\nThis project has no `verify` block in its config. Use the defaults below, and end the report with a suggested `verify` block for Project Settings (checks, sign_in, baseline, slow_backend) for this project.";
  const userNote = extra ? `\n\n## From the user\n\n${extra}` : "";

  return `# Implement ${ticket}, and prove it

You are done only when every acceptance criterion has evidence taken after your last code change and every check passes after your last code change. Keep your notes, specs and evidence in \`${dir}/\` (Argus keeps it out of git).${noVerify}

## 1. Read the ticket

Call \`linear_get_issue\` with ${code(ticket)}: description, comments and attached screenshots. Write every item under its expected behaviour or acceptance criteria to \`${dir}/criteria.md\`, numbered, one observable behaviour per line. If it has no such section, derive the list from the description and say so in the report.

## 2. Extract every design up front

Collect every Figma link in the ticket and its comments. Hand this to a subagent if you can, so the frames don't fill your context: for each link, \`figma_get_frame\`, then save \`${dir}/figma/<frame>.md\` (link, size, layout, spacing, colors, typography, copy, designer comments) and the image as \`${dir}/figma/<frame>.png\`, plus \`${dir}/figma/index.md\` mapping each criterion to its frames. \`figma_export_assets\` brings the real icons and images. Re-read these files while implementing rather than fetching again. No Figma links: say so and move on.

## 3. Get the devices ready

${devicesStep(verify, runCommands, ticketKey(ticket))}

## 4. Baseline

${baselineStep(verify, dir)}

## 5. Implement

Build what the criteria and the frame specs say, reusing the project's existing components and tokens.

## 6. Verify every criterion

For each criterion, on every device:
- Drive it with conductor as a user would (\`tap-on\`, \`input-text\`, \`swipe\`, \`open-link\`, …).
- Confirm the result from \`conductor capture-ui\` or \`inspect\` — the text, state or element on screen — not from reading the code.
- Save a screenshot to \`${dir}/evidence/<criterion>-<device>.png\`.
- With a frame: \`design_compare\` with its link and the device. Write every difference (spacing, color, type, copy, a missing element) to \`${dir}/differences.md\`, marked fixed or explained (real data, the status bar).
- Against the baseline: nothing outside the ticket changed.${loadingCheck(verify)}

## 7. Checks

${checksStep(verify)}

## 8. Loop

A failed criterion, an unexplained difference or a failed check: fix it, then redo step 6 for every criterion the fix could touch and rerun step 7. A code edit makes all evidence taken before it stale. Stop only when a full pass of steps 6 and 7 has no code change after it.

## 9. Report

End with:
- **Criteria**: a table with one row per criterion and device — the screenshot path, what \`capture-ui\` showed, the \`design_compare\` result and any remaining difference, and pass or fail.
- **Devices**: each device you used, whether it was yours or a throwaway, and why.
- **Checks**: each command and its result.
- **Not verified**: anything you couldn't check, and why.

State that every piece of evidence was taken after your last code change.${userNote}`;
}
