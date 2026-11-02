import type { PullStrategy } from "@argus/peacock";
import { useEffect, useState } from "react";
import { gitGetConfig } from "../../../lib/ipc";
import { pullStrategyFromConfig } from "../../../lib/pullStrategy";

/** The repo's own pull strategy from its `.git/config`, as the Mac app's Git settings show it. */
export function useRepoPullStrategy(sessionId: string): PullStrategy {
  const [strategy, setStrategy] = useState<PullStrategy>("merge");
  useEffect(() => {
    let live = true;
    Promise.all([
      gitGetConfig(sessionId, "pull.rebase"),
      gitGetConfig(sessionId, "pull.ff"),
    ])
      .then(([rebase, ff]) => {
        if (live) {
          setStrategy(pullStrategyFromConfig(rebase, ff));
        }
      })
      .catch(() => live && setStrategy("merge"));

    return () => {
      live = false;
    };
  }, [sessionId]);

  return strategy;
}
