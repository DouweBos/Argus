import type { Meta, StoryObj } from "@storybook/react";
import { ArgusLogo } from "../../icons/Icons";
import { UsageMeter } from "../UsageMeter/UsageMeter";
import {
  HomeLink,
  HomeNote,
  HomeOverview,
  HomeSection,
  ProjectTile,
  ProjectTileGrid,
} from "./HomeOverview";

const meta: Meta<typeof HomeOverview> = {
  title: "Screens/HomeOverview",
  component: HomeOverview,
  parameters: { layout: "padded" },
};
export default meta;
type Story = StoryObj<typeof HomeOverview>;

const noop = () => {};

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 820 }}>
      <HomeOverview icon={<ArgusLogo size={16} />} title="Argus">
        <HomeSection
          actions={<HomeLink>View usage</HomeLink>}
          title="Plan limits"
        >
          <div style={{ maxWidth: 400, display: "grid", gap: 10 }}>
            <UsageMeter
              hint="resets in 4h 27m"
              label="Session"
              progress={0.07}
              value="93% left"
            />
            <UsageMeter
              hint="resets in 4d 22h"
              label="Weekly"
              progress={0.23}
              value="77% left"
            />
          </div>
        </HomeSection>
        <HomeSection title="Projects">
          <ProjectTileGrid>
            <ProjectTile
              age="21m ago"
              name="argus-web"
              projectKey="/src/argus-web"
              summary="2 sessions · 1 agent"
              onNewSession={noop}
              onOpen={noop}
            />
            <ProjectTile
              busy
              age="now"
              name="Media Server"
              projectKey="/src/pms"
              status="accent"
              summary="5 sessions · 3 agents"
              onOpen={noop}
            />
          </ProjectTileGrid>
        </HomeSection>
        <HomeSection
          actions={<HomeLink>View all</HomeLink>}
          title="Recent runs"
        >
          <HomeNote>
            Nothing has run yet. Enable an automation, or try a quick run.
          </HomeNote>
        </HomeSection>
      </HomeOverview>
    </div>
  ),
};
