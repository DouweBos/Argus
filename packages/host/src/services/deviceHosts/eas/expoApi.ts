/**
 * Expo's GraphQL API for EAS Simulator sessions: the operations eas-cli's
 * `simulator:*` commands send. Every error is an {@link EasError} whose text
 * has the credential cut out, because these reach logs and clients.
 */

import { type ExpoCredential, EasError, scrub } from "./credential";
import { easFetch } from "./http";

const EXPO_GRAPHQL_URL = "https://api.expo.dev/graphql";
const REQUEST_TIMEOUT_MS = 30_000;

export type EasSessionStatus =
  | "ERRORED"
  | "IN_PROGRESS"
  | "NEW"
  | "QUEUED"
  | "STARTING"
  | "STOPPED";

/** Statuses of a session that may still bill. */
export const ACTIVE_STATUSES: EasSessionStatus[] = [
  "NEW",
  "QUEUED",
  "STARTING",
  "IN_PROGRESS",
];

export interface EasSession {
  id: string;
  status: EasSessionStatus;
  /** serve-sim's preview host; present once the simulator is ready. Its token grants full control. */
  preview: { url: string; token: string } | null;
}

export interface EasApp {
  id: string;
  fullName: string;
}

export interface CreateEasSessionInput {
  appId: string;
  name: string;
  maxRunTimeMinutes: number;
  maxIdleTimeMinutes: number;
}

const VIEWER = `query ArgusExpoViewer {
  meActor {
    __typename
    ... on UserActor { username }
    ... on Robot { firstName }
    accounts {
      name
      appsPaginated(first: 100) { edges { node { id fullName } } }
    }
  }
}`;

const AVAILABILITY = `query ArgusEasSimulatorAvailability($appId: String!, $filter: [String!]) {
  app { byId(appId: $appId) { ownerAccount { name accountFeatureGates(filter: $filter) } } }
}`;

const CREATE = `mutation ArgusCreateEasSimulatorSession($input: CreateDeviceRunSessionInput!) {
  deviceRunSession { createDeviceRunSession(deviceRunSessionInput: $input) { id } }
}`;

const SESSION = `query ArgusEasSimulatorSession($id: ID!) {
  deviceRunSessions {
    byId(deviceRunSessionId: $id) {
      id
      status
      remoteConfig {
        ... on AgentDeviceRunSessionRemoteConfig { webPreviewToken previewApiUrl }
      }
    }
  }
}`;

const ACTIVE = `query ArgusActiveEasSimulatorSessions($appId: String!, $filter: DeviceRunSessionFilterInput) {
  app {
    byId(appId: $appId) {
      deviceRunSessionsPaginated(first: 50, filter: $filter) { edges { node { id status name } } }
    }
  }
}`;

const STOP = `mutation ArgusStopEasSimulatorSession($id: ID!) {
  deviceRunSession { ensureDeviceRunSessionStopped(deviceRunSessionId: $id) { id status } }
}`;

const DEVICE_RUN_SESSIONS_GATE = "device-run-sessions";

interface GraphQlError {
  message?: string;
  extensions?: {
    errorCode?: string;
    errorType?: string;
    isTransient?: boolean;
  };
}

/**
 * Expo answered and refused, so a mutation did nothing: a 4xx, or GraphQL
 * user errors with no data. A 5xx, a transient or server-side error, or no
 * answer at all may follow a request that ran (eas-cli's rule).
 */
function refused(status: number, errors: GraphQlError[], data: unknown) {
  if (status >= 500) {
    return false;
  }
  if (status >= 400) {
    return true;
  }
  const fault = errors.some(
    ({ extensions: x }) =>
      x?.isTransient === true ||
      (x?.errorType !== undefined && x.errorType !== "USER") ||
      x?.errorCode === "INTERNAL_SERVER_ERROR",
  );
  const usersFault =
    errors.length > 0 &&
    errors.every(({ extensions: x }) => x?.errorType === "USER");

  return !fault && data === null && usersFault;
}

export function makeExpoApi(credential: ExpoCredential) {
  async function call<T>(
    operation: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const fail = (
      failure: "api" | "auth_rejected" | "network" | "timeout",
      detail: string,
      rejected: boolean,
      status?: number,
    ) =>
      new EasError(
        failure,
        `Expo could not ${operation}: ${scrub(detail, credential.secret, credential.header.value)}`,
        rejected,
        status,
      );
    let response: Response;
    try {
      response = await easFetch(EXPO_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [credential.header.name]: credential.header.value,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      throw fail(
        timedOut ? "timeout" : "network",
        timedOut
          ? "Expo's API did not answer in time"
          : "Expo's API is unreachable",
        false,
      );
    }
    const { status } = response;
    if (status === 401 || status === 403) {
      const what =
        credential.source === "eas-login"
          ? "eas login session"
          : "access token";
      throw fail(
        "auth_rejected",
        `the ${what} was rejected (HTTP ${String(status)})`,
        true,
        status,
      );
    }
    const body = (await response.json().catch(() => null)) as {
      data?: unknown;
      errors?: GraphQlError[];
    } | null;
    const errors: GraphQlError[] = Array.isArray(body?.errors)
      ? body.errors
      : [];
    if (status >= 400 || errors.length > 0 || !body?.data) {
      const detail =
        errors.length > 0
          ? errors.map((e) => String(e.message ?? "error")).join("; ")
          : `unexpected response (HTTP ${String(status)})`;
      throw fail(
        "api",
        detail,
        refused(status, errors, body?.data ?? null),
        status,
      );
    }

    return body.data as T;
  }

  return {
    credential,
    async viewer(): Promise<{ name: string; apps: EasApp[] }> {
      const data = await call<{
        meActor: {
          __typename: string;
          username?: string;
          firstName?: string | null;
          accounts: {
            appsPaginated: { edges: { node: EasApp }[] };
          }[];
        } | null;
      }>("read the signed-in account", VIEWER, {});
      const actor = data.meActor;
      if (!actor) {
        throw new EasError(
          "auth_rejected",
          "Expo could not read the signed-in account: no account is signed in",
          true,
        );
      }

      return {
        name: actor.username ?? actor.firstName ?? actor.__typename,
        apps: actor.accounts.flatMap((a) =>
          a.appsPaginated.edges.map(({ node }) => ({
            id: node.id,
            fullName: node.fullName,
          })),
        ),
      };
    },
    async availability(
      appId: string,
    ): Promise<{ account: string; available: boolean }> {
      const data = await call<{
        app: {
          byId: {
            ownerAccount: { name: string; accountFeatureGates: unknown };
          };
        };
      }>("check EAS Simulator access", AVAILABILITY, {
        appId,
        filter: [DEVICE_RUN_SESSIONS_GATE],
      });
      const owner = data.app.byId.ownerAccount;
      const gates = owner.accountFeatureGates as Record<string, unknown> | null;

      return {
        account: owner.name,
        available: gates?.[DEVICE_RUN_SESSIONS_GATE] === true,
      };
    },
    async create(input: CreateEasSessionInput): Promise<string> {
      const data = await call<{
        deviceRunSession: { createDeviceRunSession: { id: string } };
      }>("start a simulator session", CREATE, {
        input: {
          appId: input.appId,
          platform: "IOS",
          type: "AGENT_DEVICE",
          name: input.name,
          maxRunTimeMinutes: input.maxRunTimeMinutes,
          maxIdleTimeMinutes: input.maxIdleTimeMinutes,
          // Expo only issues the preview host's API URL when preview access is configured.
          corsOrigins: ["http://localhost"],
        },
      });

      return data.deviceRunSession.createDeviceRunSession.id;
    },
    async session(id: string): Promise<EasSession> {
      const data = await call<{
        deviceRunSessions: {
          byId: {
            id: string;
            status: EasSessionStatus;
            remoteConfig: {
              webPreviewToken?: string | null;
              previewApiUrl?: string | null;
            } | null;
          };
        };
      }>("read a simulator session", SESSION, { id });
      const s = data.deviceRunSessions.byId;
      const remote = s.remoteConfig;

      return {
        id: s.id,
        status: s.status,
        preview:
          remote?.previewApiUrl && remote.webPreviewToken
            ? { url: remote.previewApiUrl, token: remote.webPreviewToken }
            : null,
      };
    },
    async activeSessions(
      appId: string,
    ): Promise<{ id: string; name: string; status: EasSessionStatus }[]> {
      const data = await call<{
        app: {
          byId: {
            deviceRunSessionsPaginated: {
              edges: {
                node: { id: string; name: string; status: EasSessionStatus };
              }[];
            };
          };
        };
      }>("list simulator sessions", ACTIVE, {
        appId,
        filter: { statuses: ACTIVE_STATUSES },
      });

      return data.app.byId.deviceRunSessionsPaginated.edges.map(
        ({ node }) => node,
      );
    },
    async stop(id: string): Promise<EasSessionStatus> {
      const data = await call<{
        deviceRunSession: {
          ensureDeviceRunSessionStopped: { status: EasSessionStatus };
        };
      }>("stop a simulator session", STOP, { id });

      return data.deviceRunSession.ensureDeviceRunSessionStopped.status;
    },
  };
}

export type ExpoApi = ReturnType<typeof makeExpoApi>;
