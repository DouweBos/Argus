import type { ControlRequest } from "./protocol";
import { describe, expect, it } from "vitest";
import { ControlHandler, SUBAGENT_CONTEXT_HOOK_ID } from "./controlHandler";

function hookCallback(callbackId: string): ControlRequest {
  return {
    type: "control_request",
    request_id: "req-1",
    request: {
      subtype: "hook_callback",
      callback_id: callbackId,
      input: { hook_event_name: "SubagentStart", agent_type: "Explore" },
    },
  };
}

const noEmit = () => {};

describe("subagent context hook", () => {
  it("registers SubagentStart only when there is context to give", () => {
    const bare = JSON.parse(new ControlHandler("a").buildInitializeRequest());
    expect(bare.request.hooks).toBeUndefined();

    const withContext = JSON.parse(
      new ControlHandler("a").buildInitializeRequest("main", "guide"),
    );
    expect(withContext.request.appendSystemPrompt).toBe("main");
    expect(withContext.request.hooks).toEqual({
      SubagentStart: [{ hookCallbackIds: [SUBAGENT_CONTEXT_HOOK_ID] }],
    });
  });

  it("answers the hook with the context as additionalContext", () => {
    const handler = new ControlHandler("a");
    handler.buildInitializeRequest("main", "GUIDE TEXT");
    const reply = JSON.parse(
      handler.handleControlRequest(
        hookCallback(SUBAGENT_CONTEXT_HOOK_ID),
        noEmit,
      ) ?? "null",
    );
    expect(reply).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req-1",
        response: {
          hookSpecificOutput: {
            hookEventName: "SubagentStart",
            additionalContext: "GUIDE TEXT",
          },
        },
      },
    });
  });

  it("answers an unknown hook with an empty result", () => {
    const handler = new ControlHandler("a");
    handler.buildInitializeRequest("main", "GUIDE TEXT");
    const reply = JSON.parse(
      handler.handleControlRequest(hookCallback("other"), noEmit) ?? "null",
    );
    expect(reply.response.response).toEqual({});
  });
});
