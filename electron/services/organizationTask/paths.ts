/**
 * Filesystem layout for org-task host workspaces:
 *
 * ```
 * ~/.argus/org-hosts/
 *   {organizationId}/
 *     {taskId}/      <-- neutral host workspace, a plain directory
 * ```
 */

import os from "node:os";
import path from "node:path";

export function orgHostsRoot(): string {
  return path.join(os.homedir(), ".argus", "org-hosts");
}

export function orgHostOrgDir(organizationId: string): string {
  return path.join(orgHostsRoot(), organizationId);
}

export function orgHostDir(organizationId: string, taskId: string): string {
  return path.join(orgHostOrgDir(organizationId), taskId);
}
