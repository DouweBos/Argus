import type { Organization } from "../../../lib/types";
import { Icons, SidebarRepoAction, SidebarRepoGroup } from "@argus/peacock";
import {
  openOrganization,
  useCenterView,
  useSelectedOrganizationId,
} from "../../../stores/centerViewStore";
import { showEditOrganizationDialog } from "../../../stores/dialogStore";
import { selectWorkspace } from "../../../stores/workspaceStore";

interface OrganizationSegmentProps {
  org: Organization;
}

export function OrganizationSegment({ org }: OrganizationSegmentProps) {
  const centerView = useCenterView();
  const selectedOrgId = useSelectedOrganizationId();
  const isActive = centerView === "organizations" && selectedOrgId === org.id;

  const openOrganizations = () => {
    selectWorkspace(null);
    openOrganization(org.id);
  };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <SidebarRepoGroup
      name={org.name}
      color={org.accent}
      hideChevron
      active={isActive}
      leading={<Icons.OrganizationIcon size={11} />}
      subtitle={
        org.members.length === 0
          ? "no repos yet"
          : `${org.members.length} ${org.members.length === 1 ? "repo" : "repos"}`
      }
      onHeaderClick={openOrganizations}
      actions={
        <SidebarRepoAction
          title="Edit organization"
          onClick={(e) => {
            stop(e);
            showEditOrganizationDialog(org.id);
          }}
        >
          <Icons.PencilIcon size={11} />
        </SidebarRepoAction>
      }
    />
  );
}
