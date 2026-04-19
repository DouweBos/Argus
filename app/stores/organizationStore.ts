import type {
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from "../lib/ipc";
import type { Organization } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import {
  addRepoToOrganization as ipcAddRepoToOrganization,
  createOrganization as ipcCreateOrganization,
  deleteOrganization as ipcDeleteOrganization,
  listOrganizations as ipcListOrganizations,
  removeRepoFromOrganization as ipcRemoveRepoFromOrganization,
  updateOrganization as ipcUpdateOrganization,
} from "../lib/ipc";

interface OrganizationStoreData {
  error: string | null;
  loading: boolean;
  organizations: Organization[];
}

const organizationStore = create<OrganizationStoreData>(() => ({
  organizations: [],
  loading: false,
  error: null,
}));

export const useOrganizations = (): Organization[] =>
  organizationStore((s) => s.organizations);

export const useOrganizationsByRepo = (
  repoRoot: string | null,
): Organization[] => {
  const orgs = useOrganizations();
  if (!repoRoot) {
    return [];
  }

  return orgs.filter((o) => o.members.some((m) => m.repo_root === repoRoot));
};

export async function refreshOrganizations(): Promise<void> {
  organizationStore.setState({ loading: true });
  try {
    const organizations = await ipcListOrganizations();
    organizationStore.setState({ organizations, loading: false, error: null });
  } catch (e) {
    organizationStore.setState({
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<Organization> {
  const org = await ipcCreateOrganization(input);
  await refreshOrganizations();

  return org;
}

export async function updateOrganization(
  input: UpdateOrganizationInput,
): Promise<Organization> {
  const org = await ipcUpdateOrganization(input);
  await refreshOrganizations();

  return org;
}

export async function deleteOrganization(id: string): Promise<void> {
  await ipcDeleteOrganization(id);
  await refreshOrganizations();
}

export async function addRepoToOrganization(
  id: string,
  repoRoot: string,
  role: string,
): Promise<void> {
  await ipcAddRepoToOrganization(id, repoRoot, role);
  await refreshOrganizations();
}

export async function removeRepoFromOrganization(
  id: string,
  repoRoot: string,
): Promise<void> {
  await ipcRemoveRepoFromOrganization(id, repoRoot);
  await refreshOrganizations();
}

/** Subscribe to the backend `organizations:changed` event to stay in sync. */
export function useOrganizationSync(): void {
  useEffect(() => {
    refreshOrganizations().catch(() => {});
    const unsub = window.argus.on<unknown>("organizations:changed", () => {
      refreshOrganizations().catch(() => {});
    });

    return () => {
      unsub();
    };
  }, []);
}
