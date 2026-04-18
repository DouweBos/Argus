import type { Organization } from "../../../lib/types";
import { Button, Icons } from "@argus/peacock";
import {
  showCreateOrganizationDialog,
  showEditOrganizationDialog,
} from "../../../stores/dialogStore";
import { useOrganizations } from "../../../stores/organizationStore";
import styles from "./OrganizationsPanel.module.css";

export function OrganizationsPanel() {
  const orgs = useOrganizations();

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Organizations</span>
        <span className={styles.sub}>
          {orgs.length === 0
            ? "group repos that ship one product together"
            : `${orgs.length} ${orgs.length === 1 ? "org" : "orgs"}`}
        </span>
        <div className={styles.spacer} />
        <Button
          variant="ghost"
          leading={<Icons.PlusIcon size={11} />}
          onClick={showCreateOrganizationDialog}
        >
          New organization
        </Button>
      </div>

      {orgs.length === 0 ? (
        <div className={styles.empty}>
          Organizations let you group a backend + frontend + mobile repo into
          one product. Agents spawned inside a member repo inherit the
          organization&apos;s system prompt so they understand how the repos fit
          together.
        </div>
      ) : (
        <div className={styles.list}>
          {orgs.map((org) => (
            <OrganizationRow key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrganizationRow({ org }: { org: Organization }) {
  return (
    <button
      type="button"
      className={styles.row}
      onClick={() => showEditOrganizationDialog(org.id)}
    >
      <span
        className={styles.accent}
        style={{ background: org.accent }}
        aria-hidden="true"
      />
      <span className={styles.rowBody}>
        <span className={styles.name}>{org.name}</span>
        {org.description && (
          <span className={styles.desc}>{org.description}</span>
        )}
        <span className={styles.members}>
          {org.members.length === 0
            ? "no repos yet"
            : org.members
                .map((m) => basename(m.repo_root))
                .slice(0, 4)
                .join(" · ") +
              (org.members.length > 4 ? ` +${org.members.length - 4}` : "")}
        </span>
      </span>
      <Icons.ChevronRightIcon size={12} />
    </button>
  );
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}
