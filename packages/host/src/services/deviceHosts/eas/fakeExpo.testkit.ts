/**
 * A fake of Expo's GraphQL API for tests: sessions live in memory, keyed by
 * id, and every request is recorded. Nothing here reaches the network.
 */

import type { FetchFn } from "./http";

export interface FakeSession {
  id: string;
  name: string;
  appId: string;
  status: string;
  maxRunTimeMinutes?: number;
  maxIdleTimeMinutes?: number;
}

export interface FakeExpo {
  fetch: FetchFn;
  sessions: Map<string, FakeSession>;
  requests: {
    operation: string;
    variables: Record<string, unknown>;
    headers: Record<string, string>;
  }[];
  /** Preview origin handed out once a session is IN_PROGRESS. */
  previewUrl: string;
  /** Polls a session takes to go from STARTING to IN_PROGRESS. */
  startPolls: number;
  enabled: boolean;
  apps: { id: string; fullName: string }[];
  /** Make the next call of an operation fail like this. */
  failNext: Map<
    string,
    "echo" | "network" | "refused" | "server" | "unauthorized"
  >;
  token: string;
  stopped: string[];
}

export const APP_ID = "0b5a3c2e-8f4d-4c1a-9e7b-1234567890ab";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function fakeExpo(
  opts: { previewUrl?: string; fallback?: FetchFn } = {},
): FakeExpo {
  let next = 1;
  const polls = new Map<string, number>();
  const expo: FakeExpo = {
    sessions: new Map(),
    requests: [],
    previewUrl: opts.previewUrl ?? "http://127.0.0.1:1",
    startPolls: 1,
    enabled: true,
    apps: [{ id: APP_ID, fullName: "@me/app" }],
    failNext: new Map(),
    token: "preview-token-123456",
    stopped: [],
    fetch: async (input, init) => {
      const url = String(input);
      if (!url.startsWith("https://api.expo.dev/")) {
        if (opts.fallback) {
          return opts.fallback(input, init);
        }
        throw new Error(`unexpected fetch ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      const operation = /(?:query|mutation) (\w+)/.exec(body.query)?.[1] ?? "";
      const headers = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      );
      expo.requests.push({ operation, variables: body.variables, headers });
      const failure = expo.failNext.get(operation);
      if (failure) {
        expo.failNext.delete(operation);
        if (failure === "network") {
          throw new TypeError("fetch failed");
        }
        if (failure === "unauthorized") {
          return json({ errors: [{ message: "nope" }] }, 401);
        }
        if (failure === "server") {
          return json({ errors: [{ message: "boom" }] }, 502);
        }
        if (failure === "echo") {
          const secret = headers.authorization ?? headers["expo-session"] ?? "";

          return json({
            data: null,
            errors: [
              {
                message: `bad credential ${secret}`,
                extensions: { errorType: "USER" },
              },
            ],
          });
        }

        return json({
          data: null,
          errors: [{ message: "refused", extensions: { errorType: "USER" } }],
        });
      }
      const v = body.variables;
      switch (operation) {
        case "ArgusExpoViewer":
          return json({
            data: {
              meActor: {
                __typename: "UserActor",
                username: "me",
                accounts: [
                  {
                    name: "me",
                    appsPaginated: {
                      edges: expo.apps.map((node) => ({ node })),
                    },
                  },
                ],
              },
            },
          });
        case "ArgusEasSimulatorAvailability":
          return json({
            data: {
              app: {
                byId: {
                  ownerAccount: {
                    name: "me",
                    accountFeatureGates: {
                      "device-run-sessions": expo.enabled,
                    },
                  },
                },
              },
            },
          });
        case "ArgusCreateEasSimulatorSession": {
          const create = v.input as Record<string, unknown>;
          const id = `sess-${String(next++)}`;
          expo.sessions.set(id, {
            id,
            name: String(create.name),
            appId: String(create.appId),
            status: "STARTING",
            maxRunTimeMinutes: create.maxRunTimeMinutes as number,
            maxIdleTimeMinutes: create.maxIdleTimeMinutes as number,
          });

          return json({
            data: { deviceRunSession: { createDeviceRunSession: { id } } },
          });
        }
        case "ArgusEasSimulatorSession": {
          const s = expo.sessions.get(String(v.id));
          if (!s) {
            return json({
              data: null,
              errors: [
                { message: "not found", extensions: { errorType: "USER" } },
              ],
            });
          }
          const n = (polls.get(s.id) ?? 0) + 1;
          polls.set(s.id, n);
          if (s.status === "STARTING" && n >= expo.startPolls) {
            s.status = "IN_PROGRESS";
          }
          const running = s.status === "IN_PROGRESS";

          return json({
            data: {
              deviceRunSessions: {
                byId: {
                  id: s.id,
                  status: s.status,
                  remoteConfig: running
                    ? {
                        previewApiUrl: `${expo.previewUrl}/api`,
                        webPreviewToken: expo.token,
                      }
                    : null,
                },
              },
            },
          });
        }
        case "ArgusActiveEasSimulatorSessions": {
          const active = [...expo.sessions.values()].filter(
            (s) =>
              s.appId === v.appId &&
              ["NEW", "QUEUED", "STARTING", "IN_PROGRESS"].includes(s.status),
          );

          return json({
            data: {
              app: {
                byId: {
                  deviceRunSessionsPaginated: {
                    edges: active.map(({ id, name, status }) => ({
                      node: { id, name, status },
                    })),
                  },
                },
              },
            },
          });
        }
        case "ArgusStopEasSimulatorSession": {
          const s = expo.sessions.get(String(v.id));
          if (s) {
            s.status = "STOPPED";
          }
          expo.stopped.push(String(v.id));

          return json({
            data: {
              deviceRunSession: {
                ensureDeviceRunSessionStopped: {
                  id: v.id,
                  status: "STOPPED",
                },
              },
            },
          });
        }
        default:
          return json({ errors: [{ message: `unknown ${operation}` }] }, 400);
      }
    },
  };

  return expo;
}
