import { beforeEach, describe, expect, it, vi } from "vitest";
import { implementTicketPrompt, ticketKey } from "./implementTicket";
import {
  expandArgusCommand,
  parseArgusCommand,
  withArgusCommands,
} from "./index";

const config = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("../../session/argusConfig", () => ({
  loadArgusConfig: () => config.value,
}));
vi.mock("../../design/files", () => ({
  excludeFromGit: vi.fn(async () => {}),
}));
vi.mock("../../telemetry/telemetry", () => ({ capture: vi.fn() }));

describe("parseArgusCommand", () => {
  it("splits the ticket from the notes", () => {
    expect(
      parseArgusCommand(
        "/implement-ticket ENG-123 keep the old header\nplease",
      ),
    ).toEqual({
      name: "implement-ticket",
      ticket: "ENG-123",
      extra: "keep the old header\nplease",
    });
    expect(parseArgusCommand("  /implement-ticket  ")).toEqual({
      name: "implement-ticket",
      ticket: "",
      extra: "",
    });
  });

  it("ignores other commands and prose", () => {
    expect(parseArgusCommand("/compact")).toBeNull();
    expect(parseArgusCommand("/implement-tickets ENG-1")).toBeNull();
    expect(parseArgusCommand("please /implement-ticket ENG-1")).toBeNull();
  });
});

describe("withArgusCommands", () => {
  it("adds the built-ins after the runner's own, which win on a clash", () => {
    const own = {
      name: "implement-ticket",
      description: "mine",
      argumentHint: "",
    };
    expect(withArgusCommands({ commands: [own] }).commands).toEqual([own]);
    const merged = withArgusCommands({ commands: [], models: [] });
    expect(merged.commands.map((c) => c.name)).toEqual(["implement-ticket"]);
    expect(merged).toHaveProperty("models");
    expect(withArgusCommands(null)).toBeNull();
  });
});

describe("expandArgusCommand", () => {
  beforeEach(() => {
    config.value = {
      run: [{ title: "Expo" }],
      verify: {
        devices: ["iPhone 17 Pro", "iPad Pro 13-inch (M5)"],
        checks: ["pnpm tsc --noEmit", "maestro test .maestro"],
        sign_in: "/login",
        baseline: true,
        slow_backend: "pnpm proxy --delay 3000",
      },
    };
  });

  it("fills the loop from the project's verify block", () => {
    const out = expandArgusCommand("/implement-ticket ENG-273", {
      worktree: "/wt",
      runnerCommands: [],
    });
    expect(out).toContain("`linear_get_issue` with `ENG-273`");
    expect(out).toContain("`iPhone 17 Pro`, `iPad Pro 13-inch (M5)`");
    expect(out).toContain("invoking `/login`");
    expect(out).toContain("- `maestro test .maestro`");
    expect(out).toContain("`pnpm proxy --delay 3000`");
    expect(out).toContain("configured: `Expo`");
    expect(out).toContain(".argus/verify/ENG-273/baseline/");
    expect(out).not.toContain("no `verify` block");
  });

  it("leaves a runner's own command of the same name alone", () => {
    expect(
      expandArgusCommand("/implement-ticket ENG-1", {
        worktree: "/wt",
        runnerCommands: ["implement-ticket"],
      }),
    ).toBeNull();
  });

  it("falls back to defaults and asks for a verify block without one", () => {
    config.value = {};
    const out = expandArgusCommand("/implement-ticket ENG-1", {
      worktree: "/wt",
      runnerCommands: [],
    });
    expect(out).toContain("no `verify` block");
    expect(out).toContain("reserved for you");
    expect(out).toContain("`package.json` scripts");
  });
});

describe("implementTicketPrompt", () => {
  it("asks for the ticket when there is none", () => {
    expect(
      implementTicketPrompt({
        ticket: "",
        extra: "",
        verify: null,
        runCommands: [],
      }),
    ).toMatch(/without a ticket/);
  });

  it("skips the baseline when the project turned it off and appends notes", () => {
    const out = implementTicketPrompt({
      ticket: "ENG-9",
      extra: "only the empty state",
      verify: {
        devices: [],
        checks: [],
        baseline: false,
        sign_in: "./scripts/login.sh",
      },
      runCommands: [],
    });
    expect(out).toContain("Baselines are off");
    expect(out).toContain("running `./scripts/login.sh`");
    expect(out).toContain("## From the user\n\nonly the empty state");
  });

  it("keys evidence by the identifier, even from a URL", () => {
    expect(ticketKey("https://linear.app/acme/issue/ENG-273/fix-tabs")).toBe(
      "ENG-273",
    );
    expect(ticketKey("weird ticket/../x")).toBe("weird-ticket-..-x");
  });
});
