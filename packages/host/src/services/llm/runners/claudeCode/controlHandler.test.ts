import type { ControlRequest } from "./protocol";
import { describe, expect, it } from "vitest";
import {
  ControlHandler,
  SUBAGENT_CONTEXT_HOOK_ID,
  TURN_STOP_HOOK_ID,
} from "./controlHandler";

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
    expect(bare.request.hooks.SubagentStart).toBeUndefined();

    const withContext = JSON.parse(
      new ControlHandler("a").buildInitializeRequest("main", "guide"),
    );
    expect(withContext.request.appendSystemPrompt).toBe("main");
    expect(withContext.request.hooks).toMatchObject({
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

describe("turn stop hook", () => {
  function stop(input: Record<string, unknown>) {
    const handler = new ControlHandler("a");
    const init = JSON.parse(handler.buildInitializeRequest());
    const emitted: [string, unknown][] = [];
    const reply = handler.handleControlRequest(
      {
        type: "control_request",
        request_id: "req-2",
        request: {
          subtype: "hook_callback",
          callback_id: TURN_STOP_HOOK_ID,
          input,
        },
      },
      (channel, data) => emitted.push([channel, data]),
    );

    return { init, emitted, reply: JSON.parse(reply ?? "null") };
  }

  it("is registered without any context", () => {
    expect(stop({}).init.request.hooks.Stop).toEqual([
      { hookCallbackIds: [TURN_STOP_HOOK_ID] },
    ]);
  });

  it("reports what outlives the turn, and doesn't hold it up", () => {
    const { emitted, reply } = stop({
      background_tasks: [{ id: "t1" }],
      session_crons: [{ id: "c1" }, { id: "c2" }],
    });

    expect(emitted).toEqual([
      ["agent:turn-stop:a", { tasks: 1, scheduled: 2 }],
    ]);
    expect(reply.response.response).toEqual({});
  });

  it("says nothing for what an older CLI leaves out", () => {
    expect(stop({}).emitted).toEqual([
      ["agent:turn-stop:a", { tasks: null, scheduled: null }],
    ]);
  });
});
