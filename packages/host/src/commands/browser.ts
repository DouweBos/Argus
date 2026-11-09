import { browserDevtools } from "../services/browser/devtools";
import {
  browserElementAt,
  browserPickElement,
} from "../services/browser/elementPicker";
import { getMjpegPort } from "../services/browser/mjpegServer";
import {
  browserKeyboardEvent,
  browserMouseEvent,
  browserUpdatePreset,
  browserViewBack,
  browserViewDestroy,
  browserViewEnsure,
  browserViewForward,
  browserViewNavigate,
  browserViewReload,
  browserWheelEvent,
} from "../services/browser/view";
import { defineTypedCommand } from "../services/command/registry";

export function registerBrowserCommands(): void {
  defineTypedCommand("browser_view_ensure", (p) =>
    browserViewEnsure(p.sessionId),
  );
  defineTypedCommand("browser_view_navigate", (p) =>
    browserViewNavigate(p.sessionId, p.url),
  );
  defineTypedCommand("browser_view_back", (p) => browserViewBack(p.sessionId));
  defineTypedCommand("browser_view_forward", (p) =>
    browserViewForward(p.sessionId),
  );
  defineTypedCommand("browser_view_reload", (p) =>
    browserViewReload(p.sessionId),
  );
  defineTypedCommand("browser_view_destroy", (p) =>
    browserViewDestroy(p.sessionId),
  );
  defineTypedCommand("browser_mouse_event", (p) =>
    browserMouseEvent(p.sessionId, p.type, p.x, p.y, p.button),
  );
  defineTypedCommand("browser_keyboard_event", (p) =>
    browserKeyboardEvent(p.sessionId, p.type, p.key),
  );
  defineTypedCommand("browser_wheel_event", (p) =>
    browserWheelEvent(p.sessionId, p.x, p.y, p.deltaX, p.deltaY),
  );
  defineTypedCommand("browser_update_preset", (p) =>
    browserUpdatePreset(p.sessionId, p.preset),
  );
  defineTypedCommand("browser_devtools", (p) => browserDevtools(p.sessionId));
  defineTypedCommand("browser_element_at", (p) =>
    browserElementAt(p.sessionId, p.x, p.y),
  );
  defineTypedCommand("browser_pick_element", (p) =>
    browserPickElement(p.sessionId, p.x, p.y),
  );
  defineTypedCommand("browser_get_mjpeg_port", () => getMjpegPort());
}
