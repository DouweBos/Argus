/**
 * Keeping built-in automations current without overwriting your edits.
 *
 * A template is seeded once and then belongs to you, so a release that
 * improves a playbook has no way to reach the copy already on disk. This
 * fingerprints the playbook an automation was seeded with: still matching
 * means nobody has touched it, so the new text is strictly better and is
 * adopted. Differing means you edited it, and it is left alone forever.
 */

import type { Automation } from "./models";
import crypto from "node:crypto";
import { info } from "@argus/host/logger";
import { BUILT_IN_TEMPLATES } from "./templates";

export function playbookHash(playbook: string): string {
  return crypto
    .createHash("sha256")
    .update(playbook)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Playbooks as shipped before `seeded_playbook_hash` existed. An automation
 * seeded back then has no fingerprint of its own, so matching one of these is
 * the only evidence that it is untouched. Append, never edit: dropping a hash
 * strands everyone still running that version on an old playbook.
 */
const LEGACY_PLAYBOOK_HASHES: Record<string, string[]> = {
  "standup-digest": ["c707f2e9ff881b9c"],
  "morning-triage": ["8ec6001128257713"],
  "take-the-easy-ones": ["a65435497213b9c4"],
  "pr-shepherd": ["c695c274f2d87e8f"],
  "regression-sweep": ["1d1bcd6ac78329a9"],
  "branch-janitor": ["1d8db60983918488"],
  "dependency-watch": ["6b3f0526d3313a09"],
};

/**
 * Descriptions a template has shipped with and since moved on from. The
 * description is its own free-text field in the editor, so a playbook that
 * matches is no evidence that the description was not edited — without this
 * an edit to the description alone would be silently reverted. Append the old
 * text here whenever you change a template's description.
 */
const SUPERSEDED_DESCRIPTIONS: Record<string, string[]> = {
  "standup-digest": [
    "A daily read-only summary of what every agent and branch did yesterday.",
  ],
};

/** Whether `automation` still carries the playbook it was seeded with. */
function isUnmodified(automation: Automation): boolean {
  const current = playbookHash(automation.playbook);
  // Absent, not null, on anything written before the field existed.
  const seeded = automation.seeded_playbook_hash ?? null;
  if (seeded !== null) {
    return current === seeded;
  }

  const templateId = automation.template_id ?? null;

  return (
    templateId !== null &&
    (LEGACY_PLAYBOOK_HASHES[templateId]?.includes(current) ?? false)
  );
}

/**
 * Whether the description is still stock, and so safe to replace. Judged
 * separately from the playbook because the two are edited separately.
 */
function descriptionIsStock(
  current: string,
  templateId: string,
  templateDescription: string,
): boolean {
  return (
    current === templateDescription ||
    (SUPERSEDED_DESCRIPTIONS[templateId]?.includes(current) ?? false)
  );
}

/**
 * Bring every untouched built-in up to the current template. Mutates `list`
 * and returns true when anything changed, so the caller can persist once.
 *
 * The playbook and the description are judged separately — editing one must
 * not forfeit updates to the other, and editing either must never be undone.
 * Name, schedule, scope, guardrails and the enabled flag are always yours; a
 * refresh must never re-enable an automation you turned off.
 */
export function refreshBuiltIns(list: Automation[]): boolean {
  let changed = false;

  for (const automation of list) {
    const templateId = automation.template_id ?? null;
    if (templateId === null) {
      continue;
    }
    const template = BUILT_IN_TEMPLATES[templateId];
    if (!template) {
      continue;
    }
    const templateDescription = template.description?.trim() ?? "";
    let touched = false;

    if (isUnmodified(automation)) {
      const hash = playbookHash(template.playbook);
      if (automation.playbook !== template.playbook) {
        automation.playbook = template.playbook;
        touched = true;
      }
      // Record the fingerprint either way, so the legacy table stops being
      // consulted for this automation.
      if (automation.seeded_playbook_hash !== hash) {
        automation.seeded_playbook_hash = hash;
        changed = true;
      }
    }

    if (
      automation.description.trim() !== templateDescription &&
      descriptionIsStock(
        automation.description.trim(),
        templateId,
        templateDescription,
      )
    ) {
      automation.description = templateDescription;
      touched = true;
    }

    if (touched) {
      automation.updated_at = Date.now();
      changed = true;
      info(
        `Refreshed built-in automation ${automation.id} (${automation.name}) from template ${templateId}`,
      );
    }
  }

  return changed;
}
