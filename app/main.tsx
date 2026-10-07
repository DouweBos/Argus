import "./styles/global.css";
import { initTransport } from "./lib/transport";

const params = new URLSearchParams(window.location.search);
const popoutMode = params.get("popout");
const fixtureMode = params.get("fixture");

/**
 * Fixture mode stands in for the preload bridge before anything reads it, so
 * the app renders from canned data in a plain browser tab. It also seeds the
 * `localStorage` the stores hydrate from, so it has to land before `initTheme`.
 */
async function installFixtures(): Promise<void> {
  if (!fixtureMode) {
    return;
  }
  const { installStubBridge } = await import("./lib/fixture/stubBridge");
  installStubBridge(fixtureMode, params);
}

/**
 * Preferences and per-home picks live in this Mac's host, shared with Argus
 * for Mac; the stores read the `localStorage` copy this refreshes, so it runs
 * before any of them load. Popouts share the main window's storage.
 */
async function syncHostPrefs(): Promise<void> {
  if (fixtureMode) {
    return;
  }
  const { connectHostPrefs, hydrateHostPrefs } =
    await import("./lib/hostPrefs");
  if (popoutMode) {
    connectHostPrefs();

    return;
  }
  // A host that doesn't answer must not hold the window blank.
  await Promise.race([
    hydrateHostPrefs(),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

/**
 * Settle the transport before anything else loads. In remote mode every store
 * hydrates from the attached host and namespaces its client-local caches by
 * it, so the decision has to be final before the first store module runs —
 * hence the dynamic import of the rest of the app.
 */
installFixtures()
  .then(() => syncHostPrefs().catch(() => undefined))
  .then(async () => {
    // Apply theme before first paint so there is no flash of the wrong theme.
    // Imported here, not at module scope: both stores read `localStorage` when
    // their module first evaluates, which has to be after fixtures seed it.
    const { initTheme } = await import("./stores/themeStore");
    const { initUiScale } = await import("./stores/uiScaleStore");
    initTheme();
    initUiScale();

    return initTransport();
  })
  .catch(() => undefined)
  .then(async () => {
    const { boot } = await import("./boot");
    boot(popoutMode, params);
  })
  .catch((err: unknown) => {
    // Fixture runs must not swallow a boot failure — a blank page is
    // indistinguishable from a successful empty render otherwise.
    if (fixtureMode) {
      window.__argusFixtureErrors?.push(`boot: ${String(err)}`);
    }
  });
