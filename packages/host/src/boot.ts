/**
 * Host lifecycle — everything the core needs to come up and go down, with no
 * window in sight. The desktop shell calls these around its own window, tray
 * and menu work; `bin/argus-host.ts` calls them and nothing else.
 */

import { addHostEventSink } from "@argus/host/bus";
import { registerHostCommands } from "./commands/index";
import { createLogger } from "./logger";
import { hostPlatform } from "./platform";
import { stopPowerAssertion } from "./serverMode";
import { startAccount, stopAccount } from "./services/account/service";
import { destroyAllAgents, spawnSpare } from "./services/agent/agentService";
import {
  startHostConversations,
  stopHostConversations,
} from "./services/agent/conversation/hostDriver";
import { startPinnedChats } from "./services/agent/pins/resume";
import { reapOrphanedAgentProcesses } from "./services/agent/reapOrphans";
import { startWarmPolicy, stopWarmPolicy } from "./services/agent/warmPolicy";
import { migrateLegacyDefaultModel } from "./services/appSettings/store";
import { initAutomations } from "./services/automation/manager";
import { initAutomationOutcomes } from "./services/automation/outcomes";
import {
  startAutomationScheduler,
  stopAutomationScheduler,
} from "./services/automation/scheduler";
import { stopAllScreencasts } from "./services/browser/cdpScreencast";
import {
  startMjpegServer,
  stopMjpegServer,
} from "./services/browser/mjpegServer";
import { webBrowserPool } from "./services/browser/pool";
import {
  applyActiveAccountToProcessEnv,
  ensureDefaultAccountSeeded,
} from "./services/claudeAuth/accounts";
import { initCodeService, stopCodeService } from "./services/code/lifecycle";
import { stopAllDebugStreams } from "./services/conductor/debug";
import { initConductorOverride } from "./services/conductor/override";
import {
  initEasDeviceHosts,
  stopEasDeviceHosts,
} from "./services/deviceHosts/eas/registry";
import { stopDeviceHosts } from "./services/deviceHosts/registry";
import {
  importCliChats,
  importEnabled,
  startCliChatImport,
} from "./services/externalChats/importer";
import {
  startSessionPullRequests,
  stopSessionPullRequests,
} from "./services/github/sessionPullRequests";
import { initIssueReports } from "./services/integrations/report";
import {
  initLanguageServers,
  stopAllLanguageServers,
} from "./services/lsp/watchedFiles";
import { startMcpServer, stopMcpServer } from "./services/mcp/server";
import { disconnectDevice } from "./services/remote/gateway";
import { installRemoteStatusBroadcast } from "./services/remote/remoteAdmin";
import {
  applyRemoteSettings,
  setRemoteConfig,
  setWebClientDir,
  stopRemote,
} from "./services/remote/remoteService";
import { restoreScratchPads } from "./services/scratchPad/manager";
import { migrateLegacySecretStores } from "./services/secrets/legacyStores";
import { stopAllBranchTracking } from "./services/session/branchTracker";
import { restoreRepoRoots } from "./services/session/manager";
import {
  startVolumeWatcher,
  stopVolumeWatcher,
} from "./services/session/volumeWatcher";
import {
  startHeapSampling,
  stopHeapSampling,
} from "./services/telemetry/heapSample";
import {
  capture as telemetryCapture,
  captureWhenEnabled,
  initTelemetry,
  shutdownTelemetry,
} from "./services/telemetry/telemetry";
import {
  destroyAllTerminals,
  destroyAllTerminalsAndWait,
} from "./services/terminal/multiplexer";
import { reapOrphanedSpawnHelpers } from "./services/terminal/reapOrphans";
import { fixProcessPath } from "./services/terminal/shellEnv";

const log = createLogger("boot");

/**
 * Move stores Electron's `safeStorage` sealed onto the shared scheme. Only a
 * platform that can still read them (Electron) supplies `legacySecretStorage`.
 */
function migrateSecretStores(): void {
  const platform = hostPlatform();
  if (!platform.legacySecretStorage) {
    return;
  }
  for (const result of migrateLegacySecretStores(
    platform.legacySecretStorage,
    platform.secretStorage,
  )) {
    if (result.outcome === "failed") {
      log.warn(
        `[secrets] ${result.store} not migrated, staying on safeStorage until next launch: ${result.error}`,
      );
    } else if (result.outcome === "migrated") {
      log.info(`[secrets] ${result.store} moved off safeStorage`);
    }
    // `already` is every launch after the first: nothing to measure.
    if (result.outcome !== "already") {
      captureWhenEnabled("secret_store_migrated", {
        store: result.store,
        outcome: result.outcome,
      });
    }
  }
}

export interface StartHostOptions {
  /**
   * Bring the gateway up regardless of the user's remote setting. A headless
   * host has no other way in.
   */
  forceRemote?: boolean;
  /** Built web client to serve over the gateway, if one is available. */
  webClientDir?: string | null;
}

export interface StartedHost {
  /** Settles once the gateway is listening, or with why it failed to start. */
  remoteReady: Promise<{ error: string | null }>;
}

/**
 * Bring the host core up: restore state, start the clock, the MCP server, the
 * gateway and the MJPEG server, and register every host command. Install the
 * platform (`setHostPlatform`) before calling this.
 */
export function startHost(options: StartHostOptions = {}): StartedHost {
  // Anonymous telemetry. Starts in presence mode (one heartbeat per launch);
  // the renderer raises it to full if the user opted in during onboarding.
  initTelemetry();

  // Restore a user-pinned conductor version, installing it in the background
  // if it isn't provisioned yet. Falls back to the bundled version meanwhile.
  initConductorOverride();

  // Before anything opens the device store or an MCP token.
  migrateSecretStores();
  migrateLegacyDefaultModel();

  // The projects this host had open last run. Must happen before the gateway
  // accepts anyone: a client hydrates from this set the moment it attaches,
  // and on a headless host nothing else would ever fill it.
  restoreRepoRoots();
  restoreScratchPads();
  startVolumeWatcher();
  startSessionPullRequests();

  initAutomations();
  initAutomationOutcomes();
  initIssueReports();
  startAutomationScheduler();

  // Chats run with the plain CLI join each project's history.
  startCliChatImport();
  addHostEventSink((channel, args) => {
    if (
      channel === "project:added" &&
      typeof args[0] === "string" &&
      importEnabled()
    ) {
      importCliChats(args[0]).catch(() => undefined);
    }
  });

  // The code editor's watches, searches and language servers end with their session.
  initCodeService();
  initLanguageServers();

  // node-pty spawn-helpers and claude subprocesses from prior runs that never
  // got to clean up reparent to launchd and pile up across restarts.
  reapOrphanedSpawnHelpers().catch((err) => {
    log.error("reapOrphanedSpawnHelpers failed:", err);
  });
  reapOrphanedAgentProcesses().catch((err) => {
    log.error("reapOrphanedAgentProcesses failed:", err);
  });

  // A GUI-launched process gets launchd's bare PATH, not the login shell's.
  for (const line of fixProcessPath()) {
    log.info(`[shellEnv] ${line}`);
  }

  // Point this process (and everything inheriting its env) at the active
  // Claude account, adopting any pre-existing `claude` login on first run.
  applyActiveAccountToProcessEnv();
  ensureDefaultAccountSeeded().catch((err) => {
    log.error("Failed to seed the default Claude account:", err);
  });

  startMcpServer().catch((err) => {
    log.error("Failed to start MCP server:", err);
  });

  // Before any listing: EAS devices resolve through their own namespace, and
  // billed sessions an earlier process left running get stopped.
  initEasDeviceHosts();

  // Commands first, so nothing that attaches over the gateway finds a gap.
  registerHostCommands();
  // Until a UI claims them, the host folds agent conversations itself.
  startHostConversations();
  startWarmPolicy({ spawn: spawnSpare });
  // Pinned chats come back idle once the MCP server is listening.
  startPinnedChats();

  setWebClientDir(options.webClientDir ?? null);
  const remoteReady = (
    options.forceRemote
      ? setRemoteConfig({ enabled: true }).then(() => undefined)
      : applyRemoteSettings()
  ).then(
    () => ({ error: null }),
    (err: unknown) => {
      log.error("Failed to start remote access:", err);

      return { error: err instanceof Error ? err.message : String(err) };
    },
  );

  // Push status to every client whenever the tunnel state changes (e.g. a
  // quick tunnel finishing startup and revealing its URL).
  installRemoteStatusBroadcast();

  // Linked hosts publish presence and poll the account log; unlinked ones idle.
  startAccount({ disconnect: disconnectDevice }).catch((err) => {
    log.error("Failed to start the account link:", err);
  });

  startMjpegServer().catch((err) => {
    log.error("Failed to start MJPEG server:", err);
  });

  startHeapSampling();

  return { remoteReady };
}

/**
 * Stop every long-lived host service that needs no waiting on. Synchronous,
 * so a shell can interleave its own teardown (telling windows to save) before
 * the processes go.
 */
export function stopHostServices(): void {
  telemetryCapture("app_quit");
  stopHeapSampling();
  shutdownTelemetry().catch(() => undefined);
  stopAutomationScheduler();
  stopVolumeWatcher();
  stopAllBranchTracking();
  stopSessionPullRequests();
  stopHostConversations();
  stopWarmPolicy();
  stopMcpServer();
  stopRemote();
  stopAccount();
  stopMjpegServer();
  stopAllScreencasts();
  stopAllDebugStreams();
  stopDeviceHosts();
  stopCodeService();
  stopAllLanguageServers();
  stopPowerAssertion();
  webBrowserPool.releaseAll().catch((err) => {
    log.error("webBrowserPool.releaseAll failed:", err);
  });
}

/**
 * Tear down every PTY and agent subprocess and wait for them to exit, so
 * run-commands and their detached grandchildren don't outlive the host and
 * node-pty's spawn-helpers get reaped instead of reparenting to launchd.
 */
export async function terminateHostProcesses(): Promise<void> {
  await Promise.allSettled([
    // Every EAS session bills until it stops; bounded, the rest is swept next launch.
    stopEasDeviceHosts(),
    destroyAllTerminalsAndWait(1500),
    // `kill()` escalates to SIGKILL after 2 s for a child ignoring SIGTERM.
    destroyAllAgents(),
  ]);
}

/** Orderly shutdown: stop services, then wait for child processes to exit. */
export async function shutdownHost(): Promise<void> {
  stopHostServices();
  await terminateHostProcesses();
}

/**
 * Last-ditch cleanup for exits that skip the orderly path (signals, uncaught
 * exits). Synchronous, so it still runs while the event loop is going away.
 */
export function syncHostCleanup(): void {
  try {
    destroyAllTerminals();
  } catch {
    // Best-effort; we're on the way out.
  }
  try {
    // Kill the tunnel child too, else cloudflared/tailscale orphans.
    stopRemote();
  } catch {
    // Best-effort; we're on the way out.
  }
  try {
    stopAllLanguageServers();
  } catch {
    // Best-effort; we're on the way out.
  }
  try {
    stopDeviceHosts();
  } catch {
    // Best-effort; we're on the way out.
  }
  stopPowerAssertion();
}
