/**
 * Organization CRUD and lookups. Mutations persist to `organizations.json`
 * and emit an `organizations:changed` event to the renderer.
 */

import type { Organization, OrganizationMember } from "./models";
import crypto from "node:crypto";
import fs from "node:fs";
import { info } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { isGitRepo } from "../mcp/projects";
import { addRepoRoot, createHeadWorkspace } from "../workspace/manager";
import { ORGANIZATION_ACCENTS } from "./models";
import { loadOrganizations, saveOrganizations } from "./store";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Load persisted organizations into `appState.organizations` and register
 * each member repo as a repo root (so the UI surfaces them on startup).
 */
export function initOrganizations(): void {
  const orgs = loadOrganizations();
  for (const org of orgs) {
    appState.organizations.set(org.id, org);
    for (const member of org.members) {
      if (
        fs.existsSync(member.repo_root) &&
        isGitRepo(member.repo_root) &&
        !appState.repoRoots.has(member.repo_root)
      ) {
        addRepoRoot(member.repo_root);
        createHeadWorkspace(member.repo_root);
      }
    }
  }
  info(`Loaded ${orgs.length} organization(s) from disk.`);
}

function persist(): void {
  saveOrganizations([...appState.organizations.values()]);
  getMainWindow()?.webContents.send("organizations:changed");
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Return every organization, sorted by name. */
export function listOrganizations(): Organization[] {
  return [...appState.organizations.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/** Return the organizations that include the given repo root as a member. */
export function organizationsForRepo(repoRoot: string): Organization[] {
  const out: Organization[] = [];
  for (const org of appState.organizations.values()) {
    if (org.members.some((m) => m.repo_root === repoRoot)) {
      out.push(org);
    }
  }

  return out;
}

function nextAccent(): string {
  const used = new Set(
    [...appState.organizations.values()].map((o) => o.accent),
  );
  for (const color of ORGANIZATION_ACCENTS) {
    if (!used.has(color)) {
      return color;
    }
  }

  return ORGANIZATION_ACCENTS[0];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateOrganizationInput {
  name: string;
  description?: string;
  system_prompt?: string;
  accent?: string;
  members?: OrganizationMember[];
}

export function createOrganization(
  input: CreateOrganizationInput,
): Organization {
  const name = input.name.trim();
  if (!name) {
    throw "Organization name is required.";
  }

  const now = Date.now();
  const org: Organization = {
    id: crypto.randomUUID(),
    name,
    description: (input.description ?? "").trim(),
    system_prompt: (input.system_prompt ?? "").trim(),
    accent: input.accent?.trim() || nextAccent(),
    members: (input.members ?? []).map(normalizeMember),
    created_at: now,
    updated_at: now,
  };

  appState.organizations.set(org.id, org);
  registerMemberRepos(org.members);
  persist();

  return org;
}

export interface UpdateOrganizationInput {
  name?: string;
  description?: string;
  system_prompt?: string;
  accent?: string;
  members?: OrganizationMember[];
}

export function updateOrganization(
  id: string,
  patch: UpdateOrganizationInput,
): Organization {
  const existing = appState.organizations.get(id);
  if (!existing) {
    throw `Organization not found: ${id}`;
  }

  const updated: Organization = {
    ...existing,
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.description !== undefined && {
      description: patch.description.trim(),
    }),
    ...(patch.system_prompt !== undefined && {
      system_prompt: patch.system_prompt.trim(),
    }),
    ...(patch.accent !== undefined && { accent: patch.accent.trim() }),
    ...(patch.members !== undefined && {
      members: patch.members.map(normalizeMember),
    }),
    updated_at: Date.now(),
  };

  if (!updated.name) {
    throw "Organization name is required.";
  }

  appState.organizations.set(id, updated);
  registerMemberRepos(updated.members);
  persist();

  return updated;
}

export function deleteOrganization(id: string): void {
  if (!appState.organizations.delete(id)) {
    throw `Organization not found: ${id}`;
  }
  persist();
}

export function addRepoToOrganization(
  orgId: string,
  member: OrganizationMember,
): Organization {
  const org = appState.organizations.get(orgId);
  if (!org) {
    throw `Organization not found: ${orgId}`;
  }
  const normalized = normalizeMember(member);
  const existingIdx = org.members.findIndex(
    (m) => m.repo_root === normalized.repo_root,
  );
  const members =
    existingIdx >= 0
      ? org.members.map((m, i) => (i === existingIdx ? normalized : m))
      : [...org.members, normalized];

  return updateOrganization(orgId, { members });
}

export function removeRepoFromOrganization(
  orgId: string,
  repoRoot: string,
): Organization {
  const org = appState.organizations.get(orgId);
  if (!org) {
    throw `Organization not found: ${orgId}`;
  }

  return updateOrganization(orgId, {
    members: org.members.filter((m) => m.repo_root !== repoRoot),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeMember(member: OrganizationMember): OrganizationMember {
  const repoRoot = member.repo_root.trim();
  if (!repoRoot) {
    throw "Member repo_root is required.";
  }

  return {
    repo_root: repoRoot,
    role: (member.role ?? "").trim(),
  };
}

function registerMemberRepos(members: OrganizationMember[]): void {
  for (const m of members) {
    if (appState.repoRoots.has(m.repo_root)) {
      continue;
    }
    if (!fs.existsSync(m.repo_root) || !isGitRepo(m.repo_root)) {
      continue;
    }
    addRepoRoot(m.repo_root);
    createHeadWorkspace(m.repo_root);
  }
}
