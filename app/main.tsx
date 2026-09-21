import "./styles/global.css";
import { initTransport } from "./lib/transport";
import { initTheme } from "./stores/themeStore";
import { initUiScale } from "./stores/uiScaleStore";

// Apply theme before first paint so there is no flash of the wrong theme.
initTheme();
initUiScale();

const params = new URLSearchParams(window.location.search);
const popoutMode = params.get("popout");

/**
 * Settle the transport before anything else loads. In remote mode every store
 * hydrates from the attached host and namespaces its client-local caches by
 * it, so the decision has to be final before the first store module runs —
 * hence the dynamic import of the rest of the app.
 */
initTransport()
  .catch(() => undefined)
  .then(async () => {
    const { boot } = await import("./boot");
    boot(popoutMode, params);
  })
  .catch(() => undefined);
