/** An agent's MCP servers and whether each connected, fetched when opened. */

import { useEffect, useMemo } from "react";
import { mcpServerViews } from "@argus/client-core";
import { Dialog, DialogBody, McpServerList } from "@argus/peacock";
import { useAgentExtrasStore } from "../stores/agentExtras";
import { capture } from "../telemetry/telemetry";

export function McpServersDialog({
  agentId,
  onClose,
}: {
  agentId: string;
  onClose: () => void;
}) {
  const mcp = useAgentExtrasStore((s) => s.mcpByAgent[agentId]);
  const error = useAgentExtrasStore((s) => s.mcpErrorByAgent[agentId] ?? null);
  const loadMcp = useAgentExtrasStore((s) => s.loadMcp);

  useEffect(() => {
    capture("web_mcp_servers_opened");
  }, []);
  useEffect(() => {
    void loadMcp(agentId);
  }, [agentId, loadMcp]);

  const servers = useMemo(() => {
    if (!mcp) {
      return null;
    }

    return mcp.servers ? mcpServerViews(mcp.servers) : "unsupported";
  }, [mcp]);

  return (
    <Dialog title="MCP servers" titleId="aw-mcp-servers" onClose={onClose}>
      <DialogBody flush>
        <McpServerList
          error={error}
          servers={servers}
          onRetry={() => {
            void loadMcp(agentId);
          }}
        />
      </DialogBody>
    </Dialog>
  );
}
