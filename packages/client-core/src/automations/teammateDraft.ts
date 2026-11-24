/**
 * A teammate's profile while it is being edited, the twin of ArgusCore's
 * `TeammateDraft`. Saving is explicit, so this holds the edits.
 */

import type {
  AutonomyLevel,
  Teammate,
  TeammateAvatar,
  TeammateClearableField,
  TeammateColor,
  UpdateTeammateInput,
} from "@argus/remote-protocol";

export interface TeammateDraft {
  name: string;
  handle: string;
  tagline: string;
  color: TeammateColor;
  avatar: TeammateAvatar;
  soul: string;
  /** Null inherits the computer's default rung. */
  autonomy: AutonomyLevel | null;
  repoRoots: string[];
}

export function teammateDraft(teammate: Teammate, soul: string): TeammateDraft {
  return {
    name: teammate.name,
    handle: teammate.handle,
    tagline: teammate.tagline,
    color: teammate.color,
    avatar: teammate.avatar,
    soul,
    autonomy: teammate.autonomy,
    repoRoots: teammate.scope.repo_roots,
  };
}

/** Why the handle can't be saved, matching the computer's rule. */
export function teammateHandleError(handle: string): string | null {
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(handle)
    ? null
    : "Lowercase letters, digits and dashes, up to 32.";
}

export function teammateCanSave(draft: TeammateDraft): boolean {
  return draft.name.trim() !== "" && teammateHandleError(draft.handle) === null;
}

export function teammateDraftChanged(
  a: TeammateDraft,
  b: TeammateDraft,
): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/**
 * Everything but the soul, which saves on its own. Inheriting goes in
 * `clear`, since a null in the patch reads as "leave it".
 */
export function teammatePatch(draft: TeammateDraft): {
  patch: UpdateTeammateInput;
  clear: TeammateClearableField[];
} {
  return {
    patch: {
      name: draft.name.trim(),
      handle: draft.handle,
      tagline: draft.tagline.trim(),
      color: draft.color,
      avatar: draft.avatar,
      scope: { repo_roots: draft.repoRoots },
      ...(draft.autonomy && { autonomy: draft.autonomy }),
    },
    clear: draft.autonomy ? [] : ["autonomy"],
  };
}
