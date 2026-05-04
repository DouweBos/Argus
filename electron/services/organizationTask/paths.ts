/**
 * Filesystem layout for org-task host sessions:
 *
 * ```
 * ~/.argus/org-hosts/
 *   {organizationId}/
 *     {taskId}/      <-- neutral host session, a plain directory
 * ```
 */

import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";

export function orgHostsRoot(): string {
  return path.join(argusHomeDir(), "org-hosts");
}

export function orgHostOrgDir(organizationId: string): string {
  return path.join(orgHostsRoot(), organizationId);
}

export function orgHostDir(organizationId: string, taskId: string): string {
  return path.join(orgHostOrgDir(organizationId), taskId);
}
