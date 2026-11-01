import { useCallback, useEffect, useState } from "react";
import {
  AccountMemberList,
  Banner,
  Icons,
  SidebarHeaderAction,
} from "@argus/peacock";
import { useAccountStore } from "../account/accountStore";
import { type AccountComputer, presenceLabel } from "../account/directory";
import { AccountFields } from "./AccountFields";
import { HostedFrame } from "./HostedFrame";
import { appNavigate, currentLocation } from "../routing/router";
import { HOME } from "../routing/screens";

/** The directory moves slowly; a visible list re-reads it this often (as the apps do). */
const DIRECTORY_REFRESH_MS = 60_000;

function detailFor(computer: AccountComputer, now: number): string {
  const presence = presenceLabel(computer, now);
  if (computer.routes.length === 0) {
    return `${presence} · no secure route — turn on remote access on that computer`;
  }

  return presence;
}

function useDirectoryRefresh(refresh: () => Promise<void>): void {
  useEffect(() => {
    const run = () => void refresh();
    run();
    const id = setInterval(run, DIRECTORY_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
}

/** Reopening the last computer happens once per page load, so Back can leave it. */
let reopened = false;

/** Every computer on the account; picking one opens it (`?host=`) in the monitor. */
export function ComputersScreen() {
  const computers = useAccountStore((s) => s.computers);
  const lastHostId = useAccountStore((s) => s.lastHostId);
  const error = useAccountStore((s) => s.error);
  const refresh = useAccountStore((s) => s.refresh);
  const [showAccount, setShowAccount] = useState(false);
  const now = Date.now();

  useDirectoryRefresh(useCallback(() => refresh(), [refresh]));

  // Back on the computer used last time, once per visit, on whatever path
  // the visit opened (a link without `?host=`).
  useEffect(() => {
    if (reopened || !lastHostId) {
      return;
    }
    const last = computers.find((c) => c.id === lastHostId);
    if (last && last.routes.length > 0) {
      reopened = true;
      appNavigate(currentLocation().screen, {
        hostId: last.id,
        replace: true,
      });
    }
  }, [computers, lastHostId]);

  const pick = (id: string) => {
    reopened = true;
    appNavigate(HOME, { hostId: id });
  };

  return (
    <HostedFrame
      title={showAccount ? "Account" : "Computers"}
      actions={
        <SidebarHeaderAction
          onClick={() => setShowAccount((v) => !v)}
          title={showAccount ? "Computers" : "Account"}
          aria-label={showAccount ? "Computers" : "Account"}
        >
          {showAccount ? (
            <Icons.ChevronLeftIcon size={14} />
          ) : (
            <Icons.GearIcon size={14} />
          )}
        </SidebarHeaderAction>
      }
    >
      {error && <Banner tone="error">{error}</Banner>}
      {showAccount ? (
        <AccountFields />
      ) : (
        <>
          <p className="aw-muted">
            Computers reach this browser through their own encrypted tunnel.
            Only Noise-encrypted traffic passes through it.
          </p>
          <AccountMemberList
            emptyText="No computers on your account yet. Link one from the Argus app on that computer."
            members={computers.map((c) => ({
              id: c.id,
              label: c.name,
              detail: detailFor(c, now),
              tone: c.online ? "success" : "neutral",
              disabled: c.routes.length === 0,
            }))}
            onSelect={pick}
          />
        </>
      )}
    </HostedFrame>
  );
}
