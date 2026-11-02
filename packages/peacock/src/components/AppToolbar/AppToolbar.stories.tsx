import type { Meta, StoryObj } from "@storybook/react";
import {
  GuestsIcon,
  LeftSidebarIcon,
  RefreshIcon,
  RightSidebarIcon,
} from "../../icons/Icons";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import { AppBreadcrumb, AppToolbar, AppToolbarTitle } from "./AppToolbar";

const meta: Meta<typeof AppToolbar> = {
  title: "Composites/AppToolbar",
  component: AppToolbar,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof AppToolbar>;

const noop = () => {};

export const Session: Story = {
  render: () => (
    <AppToolbar
      title={
        <AppBreadcrumb
          steps={[
            {
              label: "argus-web",
              project: { name: "argus-web", key: "/src/argus-web" },
              onClick: noop,
            },
            { label: "Restyle the web client", onClick: noop },
            { label: "Sidebar pass" },
          ]}
        />
      }
      trailing={
        <>
          <FlatIconButton icon={<GuestsIcon size={15} />} label="Share" />
          <FlatIconButton
            selected
            icon={<RightSidebarIcon size={15} />}
            label="Side panel"
          />
        </>
      }
      onBack={noop}
      onForward={noop}
    />
  ),
};

export const Overview: Story = {
  render: () => (
    <AppToolbar
      canGoForward
      title={<AppToolbarTitle subtitle="No decisions waiting" title="Inbox" />}
      trailing={
        <FlatIconButton icon={<RefreshIcon size={14} />} label="Refresh" />
      }
      onBack={noop}
      onForward={noop}
    />
  ),
};

/** The sidebar is away, so its toggle leads the bar. */
export const SidebarHidden: Story = {
  render: () => (
    <AppToolbar
      leading={
        <FlatIconButton
          icon={<LeftSidebarIcon size={15} />}
          label="Show sidebar"
        />
      }
      title={<AppToolbarTitle title="Pull Requests" subtitle="0 open" />}
      onBack={noop}
    />
  ),
};
