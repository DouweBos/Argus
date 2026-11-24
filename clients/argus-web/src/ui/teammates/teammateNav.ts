import type { TeammatePage } from "@argus/client-core";
import { appNavigate } from "../../routing/router";

/** One navigation per page switch; the conversation page opens the newest one. */
export function showTeammatePage(teammateId: string, page: TeammatePage): void {
  appNavigate({ name: "teammate", teammateId, page, threadId: null });
}
