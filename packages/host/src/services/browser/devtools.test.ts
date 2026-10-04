import { describe, expect, it } from "vitest";
import { devtoolsFor } from "./devtools";

describe("devtoolsFor", () => {
  it("makes Chromium's relative frontend URL absolute on loopback", () => {
    expect(
      devtoolsFor(9333, "T1", [
        {
          id: "T1",
          webSocketDebuggerUrl: "ws://localhost:9333/devtools/page/T1",
          devtoolsFrontendUrl:
            "/devtools/inspector.html?ws=localhost:9333/devtools/page/T1",
        },
      ]),
    ).toEqual({
      port: 9333,
      targetId: "T1",
      webSocketDebuggerUrl: "ws://127.0.0.1:9333/devtools/page/T1",
      devtoolsFrontendUrl:
        "http://127.0.0.1:9333/devtools/inspector.html?ws=localhost:9333/devtools/page/T1",
    });
  });

  it("never hands out a remote frontend", () => {
    const devtools = devtoolsFor(9333, "T1", [
      {
        id: "T1",
        devtoolsFrontendUrl:
          "https://chrome-devtools-frontend.appspot.com/serve_rev/@1/inspector.html?ws=127.0.0.1:9333/devtools/page/T1",
      },
    ]);

    expect(devtools?.devtoolsFrontendUrl).toBe(
      "http://127.0.0.1:9333/devtools/inspector.html?ws=127.0.0.1:9333/devtools/page/T1",
    );
  });

  it("is null when the page is gone", () => {
    expect(devtoolsFor(9333, "T1", [{ id: "T2" }])).toBeNull();
  });
});
