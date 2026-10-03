import { useEffect, useState } from "react";
import { LimitResumeBanner as Notice } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { getAgentLimitResume } from "../../../lib/ipc";
import styles from "./AgentChat.module.css";

/** Shown while the host waits for a spent usage limit to reset. */
export function LimitResumeBanner({ agentId }: { agentId: string }) {
  const [resumeAt, setResumeAt] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    getAgentLimitResume(agentId)
      .then((at) => live && setResumeAt(at))
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [agentId]);

  useIpcEvent<number | null>(`agent:limit-resume:${agentId}`, setResumeAt);

  if (resumeAt === null) {
    return null;
  }

  return <Notice className={styles.limitResumeBanner} resumeAt={resumeAt} />;
}
