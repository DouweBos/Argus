import type { AccountLinkState, AccountStatus } from "../lib/types";
import { useCallback, useEffect, useState } from "react";
import { accountGetStatus } from "../lib/ipc";
import { useIpcEvent } from "./useIpcEvent";

/** This computer's account status, live via `account:status`. */
export function useAccountStatus(): {
  refresh: () => Promise<void>;
  status: AccountStatus | null;
} {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const refresh = useCallback(async () => {
    setStatus(await accountGetStatus());
  }, []);

  useEffect(() => {
    accountGetStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useIpcEvent<AccountStatus>("account:status", setStatus);
  useIpcEvent<AccountLinkState>("account:link-state", (link) =>
    setStatus((s) => (s ? { ...s, link } : s)),
  );

  return { status, refresh };
}
