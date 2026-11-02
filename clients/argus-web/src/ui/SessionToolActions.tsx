/**
 * Top-bar ways into a session's files, terminals and browser, the tool screens loaded
 * on first use, and the Cmd/Ctrl+P palette over them.
 */

import { FlatIconButton, Icons, Spinner } from "@argus/peacock";
import { lazy, Suspense } from "react";
import { appNavigate } from "../routing/router";
import type { Screen } from "../routing/screens";
import type { ShipScreen } from "../routing/shipScreens";
import type { ToolScreen } from "./SessionTools";

const SessionToolBody = lazy(() => import("./SessionTools"));
const BrowserScreen = lazy(() => import("./BrowserScreen"));
const QuickOpen = lazy(() =>
  import("./QuickOpen").then((m) => ({ default: m.QuickOpen })),
);

function Loading() {
  return (
    <div className="aw-center">
      <Spinner />
    </div>
  );
}

const ShipScreenBody = lazy(() => import("./ship/ShipScreens"));

export function LazyShipScreen({ screen }: { screen: ShipScreen }) {
  return (
    <Suspense fallback={<Loading />}>
      <ShipScreenBody screen={screen} />
    </Suspense>
  );
}

export function LazySessionTool({ screen }: { screen: ToolScreen }) {
  return (
    <Suspense fallback={<Loading />}>
      <SessionToolBody screen={screen} />
    </Suspense>
  );
}

export function LazyBrowserScreen({ sessionId }: { sessionId: string }) {
  return (
    <Suspense fallback={<Loading />}>
      <BrowserScreen sessionId={sessionId} />
    </Suspense>
  );
}

/** The quick open palette for a session, over whatever screen is up. */
export function QuickOpenPalette({
  currentFile,
  onClose,
  sessionId,
}: {
  currentFile: string | null;
  onClose: () => void;
  sessionId: string;
}) {
  return (
    <Suspense fallback={null}>
      <QuickOpen
        currentFile={currentFile}
        sessionId={sessionId}
        via="shortcut"
        onClose={onClose}
      />
    </Suspense>
  );
}

function Action({
  icon,
  label,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  to: Screen;
}) {
  return (
    <FlatIconButton icon={icon} label={label} onClick={() => appNavigate(to)} />
  );
}

/** From an agent to its session's files and terminals, and from files to search. */
export function SessionToolActions({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case "agent":
      return (
        <>
          <Action
            icon={<Icons.CodeIcon size={14} />}
            label="Files"
            to={{ name: "files", sessionId: screen.sessionId }}
          />
          <Action
            icon={<Icons.TerminalIcon size={14} />}
            label="Terminals"
            to={{
              name: "terminals",
              sessionId: screen.sessionId,
              terminalId: null,
            }}
          />
          <Action
            icon={<Icons.WebIcon size={14} />}
            label="Browser"
            to={{ name: "browser", sessionId: screen.sessionId }}
          />
        </>
      );
    case "files":
    case "file":
      return (
        <Action
          icon={<Icons.SearchIcon size={14} />}
          label="Search in files"
          to={{ name: "search", sessionId: screen.sessionId }}
        />
      );
    default:
      return null;
  }
}
