import { describe, expect, it, vi } from "vitest";
import { parseArgs } from "./args";
import {
  EXIT,
  nameFromPrompt,
  runCli,
  type CliIo,
  type ToolResult,
} from "./run";

const ok = (v: unknown): ToolResult => ({
  isError: false,
  text: JSON.stringify(v),
});
const fail = (text: string): ToolResult => ({ isError: true, text });

function harness(
  handlers: Record<string, (args: Record<string, unknown>) => ToolResult>,
) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: [string, Record<string, unknown>][] = [];
  let clock = 0;
  const io: CliIo = {
    call: vi.fn(async (tool, args) => {
      calls.push([tool, args]);
      const h = handlers[tool];
      if (!h) {
        throw new Error(`unexpected ${tool}`);
      }
      clock += ((args.timeout_seconds as number | undefined) ?? 0) * 1000;

      return h(args);
    }),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    readStdin: async () => "from stdin",
    projectRoot: async () => "/repo",
    version: "1.2.3",
    now: () => clock,
  };

  return {
    io,
    out,
    err,
    calls,
    run: (argv: string[]) => runCli(parseArgs(argv), io),
  };
}

describe("argus CLI", () => {
  it("starts an agent in the project's checkout and prints its id", async () => {
    const h = harness({
      spawn_agent: () => ok({ agent_id: "a1", status: "running" }),
    });
    await expect(h.run(["session", "new", ".", "hello"])).resolves.toBe(
      EXIT.ok,
    );
    expect(h.calls[0]).toEqual([
      "spawn_agent",
      { session: "root", project_path: "/repo", prompt: "hello" },
    ]);
    expect(h.out).toEqual(["a1"]);
  });

  it("creates a worktree off the base, with stdin as the prompt", async () => {
    const h = harness({
      create_session: () =>
        ok({ agent_id: "a2", session_id: "s", status: "initializing" }),
    });
    await expect(
      h.run(["session", "new", ".", "-", "--worktree", "main"]),
    ).resolves.toBe(EXIT.ok);
    expect(h.calls[0][1]).toMatchObject({
      project_path: "/repo",
      base_branch: "main",
      prompt: "from stdin",
      name: "from stdin",
    });
  });

  it("forks the current branch for --worktree HEAD", async () => {
    const h = harness({
      create_session: () => ok({ agent_id: "a2", status: "running" }),
    });
    await h.run(["session", "new", ".", "x", "--worktree", "HEAD"]);
    expect(h.calls[0][1]).not.toHaveProperty("base_branch");
  });

  it("waits for the turn and prints the result", async () => {
    const h = harness({
      send_agent_message: () => ({
        isError: false,
        text: "Message sent to agent a1.",
      }),
      agent_status: () =>
        ok({ agent_id: "a1", status: "running", branch: "b" }),
      wait_for_agent: () =>
        ok({
          agent_id: "a1",
          status: "idle",
          result: { subtype: "success", result: "done!" },
        }),
    });
    await expect(h.run(["send", "a1", "go", "--wait"])).resolves.toBe(EXIT.ok);
    expect(h.out).toEqual(["a1  idle  b", "", "done!"]);
  });

  it("exits 3 when the agent stops to ask", async () => {
    const h = harness({
      agent_status: () => ok({ agent_id: "a1", status: "requires_action" }),
    });
    await expect(h.run(["wait", "a1"])).resolves.toBe(EXIT.waiting);
  });

  it("exits 1 when the turn failed", async () => {
    const h = harness({
      agent_status: () => ok({ agent_id: "a1", status: "running" }),
      wait_for_agent: () =>
        ok({ agent_id: "a1", status: "idle", result: { subtype: "error" } }),
    });
    await expect(h.run(["wait", "a1"])).resolves.toBe(EXIT.failed);
  });

  it("keeps waiting across slices and exits 124 at --timeout", async () => {
    const h = harness({
      agent_status: () => ok({ agent_id: "a1", status: "running" }),
      wait_for_agent: () => fail("Timeout waiting for agent a1 after 15000ms"),
    });
    await expect(h.run(["wait", "a1", "--timeout", "40"])).resolves.toBe(
      EXIT.timeout,
    );
    const slices = h.calls
      .filter(([t]) => t === "wait_for_agent")
      .map(([, a]) => a.timeout_seconds);
    expect(slices).toEqual([15, 15, 10]);
  });

  it("reports a tool error with exit 1", async () => {
    const h = harness({
      send_agent_message: () => fail("No agent found: nope"),
    });
    await expect(h.run(["send", "nope", "hi"])).resolves.toBe(EXIT.failed);
    expect(h.err).toEqual(["argus: No agent found: nope"]);
  });

  it("shows status plus the last result", async () => {
    const h = harness({
      agent_status: () => ok({ agent_id: "a1", status: "idle" }),
      get_agent_result: () =>
        ok({ agent_id: "a1", status: "idle", result: { result: "r" } }),
    });
    await expect(h.run(["show", "a1", "--json"])).resolves.toBe(EXIT.ok);
    expect(JSON.parse(h.out[0])).toMatchObject({
      status: "idle",
      result: { result: "r" },
    });
  });

  it("lists nothing when no agents run", async () => {
    const h = harness({
      list_agents: () => ({ isError: false, text: "No agents running." }),
    });
    await expect(h.run(["list", "--json"])).resolves.toBe(EXIT.ok);
    expect(h.out).toEqual(["[]"]);
  });

  it("names a session from the prompt's first words", () => {
    expect(nameFromPrompt("  fix the flaky login test on ci please now ")).toBe(
      "fix the flaky login test on",
    );
  });
});
