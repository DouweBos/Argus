import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));
vi.mock("./service", () => ({ SLACK_STATUS_CHANGED: "slack_status_changed" }));

const CONFIG = "xoxe.xoxp-1-secret-config";

function slack(body: Record<string, unknown>) {
  return vi.fn(
    async (_url: Request | URL | string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200 }),
  );
}

describe("creating the Slack app", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-slack-app-"));
    vi.stubEnv("ARGUS_HOME", home);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the app under the given name and never saves the token", async () => {
    const { createSlackApp } = await import("./appSetup");
    const fetchImpl = slack({ ok: true, app_id: "A0123" });

    const status = await createSlackApp(CONFIG, " Argus (Sam) ", fetchImpl);

    expect(status.app).toEqual({ id: "A0123", name: "Argus (Sam)" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://slack.com/api/apps.manifest.create");
    const manifest = JSON.parse(
      (JSON.parse(String(init?.body)) as { manifest: string }).manifest,
    ) as {
      display_information: { name: string };
      features: { bot_user: { display_name: string } };
      settings: { socket_mode_enabled: boolean };
    };
    expect(manifest.display_information.name).toBe("Argus (Sam)");
    expect(manifest.features.bot_user.display_name).toBe("Argus (Sam)");
    expect(manifest.settings.socket_mode_enabled).toBe(true);
    expect(
      fs.readFileSync(path.join(home, "slack.json"), "utf8"),
    ).not.toContain(CONFIG);
  });

  it("refuses a token that isn't a configuration token before calling Slack", async () => {
    const { createSlackApp } = await import("./appSetup");
    const fetchImpl = slack({ ok: true });

    await expect(
      createSlackApp("xoxb-bot", "Argus", fetchImpl),
    ).rejects.toContain("xoxe.xoxp-");
    await expect(createSlackApp(CONFIG, "", fetchImpl)).rejects.toContain(
      "name",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("explains an expired token and a rejected manifest", async () => {
    const { createSlackApp } = await import("./appSetup");

    await expect(
      createSlackApp(
        CONFIG,
        "Argus",
        slack({ ok: false, error: "token_expired" }),
      ),
    ).rejects.toContain("expired");
    await expect(
      createSlackApp(
        CONFIG,
        "Argus",
        slack({
          ok: false,
          error: "invalid_manifest",
          errors: [
            { message: "too long", pointer: "/display_information/name" },
          ],
        }),
      ),
    ).rejects.toContain("/display_information/name: too long");
  });

  it("forgets the app to start over", async () => {
    const { createSlackApp, forgetSlackApp } = await import("./appSetup");
    await createSlackApp(CONFIG, "Argus", slack({ ok: true, app_id: "A1" }));

    expect(forgetSlackApp().app).toBeNull();
  });
});
