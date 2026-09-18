/**
 * `emit_report` — the run's dashboard, as data.
 *
 * A model that writes HTML writes hardcoded colours, so it never gets to.
 * It picks structure and data from a closed union validated here against
 * `ReportDocument`; Peacock owns every pixel on the other side. Registered
 * only for automation hosts, the same way `emit_proposal` is.
 */

import { ReportDocument } from "@argus/remote-protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { updateRun } from "../automation/manager";
import { automationRunForAgent } from "./automationTools";

/**
 * The union, restated for the model. The JSON schema the SDK derives from a
 * discriminated union is unreadable once it has eight branches, so the shape
 * stays loose on the wire and strict in the handler — a malformed block comes
 * back as a tool error naming the field, which is what the model can act on.
 */
const BLOCKS_DESCRIPTION = `The report, as an ordered array of blocks. Every block is an object with a "type". The union is closed — anything else is rejected:

- {"type":"heading","text":string}
- {"type":"markdown","text":string} — prose, links and bullets
- {"type":"stats","items":[{"label":string,"value":string,"delta"?:number}]} — 1-8 headline numbers
- {"type":"table","columns":[string],"rows":[[string|number]]} — every row needs one cell per column
- {"type":"list","items":[{"text":string,"href"?:string,"tone"?:"critical"|"info"|"positive"|"warning"}]}
- {"type":"series","kind":"bar"|"line","labels":[string],"values":[number],"label"?:string} — labels and values must be the same length
- {"type":"proposals","ids":[string]} — renders live cards for proposals you emitted this run
- {"type":"sessions","ids":[string]} — renders live cards for sessions

Do not invent block types, do not emit HTML, and never put a colour anywhere.`;

function issueText(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 8)
    .map(
      (i) =>
        `${i.path.length > 0 ? `blocks.${i.path.join(".")}` : "blocks"}: ${i.message}`,
    )
    .join("; ");
}

export function registerAutomationReportTool(
  server: McpServer,
  callerAgentId: string | null,
): void {
  server.tool(
    "emit_report",
    "Publish this run's report as structured blocks instead of markdown. Call it once, near the end of the run, with everything you want the user to see. Blocks render as a real dashboard — stats, tables and charts — where your final assistant message would only render as text. A report emitted here replaces the final message as the run's report.",
    { blocks: z.array(z.unknown()).describe(BLOCKS_DESCRIPTION) },
    ({ blocks }) => {
      const context = automationRunForAgent(callerAgentId);
      if (!context) {
        return refusal("emit_report is only available to automation runs.");
      }

      const parsed = ReportDocument.safeParse({ blocks });
      if (!parsed.success) {
        return refusal(
          `Report rejected — ${issueText(parsed.error.issues)}. Fix the block and call emit_report again.`,
        );
      }

      updateRun(context.runId, { report_blocks: parsed.data.blocks });

      return {
        content: [
          {
            type: "text" as const,
            text: `Report published: ${parsed.data.blocks.length} block(s). Keep your final assistant message to a one-line summary; the blocks are what the user reads.`,
          },
        ],
      };
    },
  );
}

function refusal(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
