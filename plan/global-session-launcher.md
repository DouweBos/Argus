# Global Session Launcher

A system-wide floating prompt that lets the user start an agent in any project / session from anywhere on macOS, triggered by double-pressing the right Option key. Includes an area-screenshot mode for attaching screen regions.

## User flow

1. User double-presses **right Option** anywhere on macOS.
2. A small floating window appears at the cursor (or last position), focused, draggable by its body, with a Claude-style prompt input.
3. User types their prompt. Pills along the bottom let them pick:
   - **Project** (required)
   - **Session** — _none_ (run agent in project root) | existing session | _New session…_ (opens the existing branch-off flow inline)
   - **Model**
   - **Linked projects**
   - **Attachments** (paperclip + paste + drag-drop — same as `StartAgentDialog`)
4. User presses Cmd+Enter or Submit.
   - _none_ → spawn an agent at the project's root via the existing "host" session (or create one if missing).
   - _existing session_ → `startAgentInSession(...)` exactly like `StartAgentDialog`.
   - _new session_ → call into the same code path as `CreateSessionDialog`'s branch-off flow, with the prompt + images + model + linked-projects forwarded as a pending prompt.
5. Behind the launcher, a thin button "**Capture area**" puts the app into screenshot mode: a transparent fullscreen overlay window covers all displays; the user click-drags a rectangle; the rectangle's pixels get attached to the launcher's pending images. Esc cancels.

## Architecture

### 1. Native global key listener

The hardest piece. Electron's `globalShortcut` API can't observe bare modifier keys — it only fires on full chords. macOS solution: an `NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged)` listener, which requires Accessibility permission.

**Decision:** extend `native/argus-sim-bridge` (already a Swift/ObjC binary speaking JSON-over-stdio to the Node main process) — OR add a sibling binary `argus-hotkey-bridge`. Adding to the existing bridge keeps the install surface small but couples concerns; a sibling binary is cleaner. **Going with sibling binary `argus-hotkey-bridge`** to keep simulator work isolated.

The Swift binary:

- Registers an `NSEvent` global monitor for `.flagsChanged`.
- Detects double-press of right Option (keyCode 61). Window: 350ms.
- Emits `{ "event": "trigger" }` on stdout.
- Reports permission status; if not granted, emits `{ "event": "permission_denied" }` and exits 0 — the renderer surfaces a one-time toast linking to System Settings.

A new electron service `electron/services/hotkey/` spawns the binary, parses the JSON stream, and on `trigger` shows the launcher window.

Falls back gracefully if the binary fails — feature simply doesn't fire, and the user can still open the launcher from a menu item / `Cmd+Shift+Space` (registered via `globalShortcut`).

### 2. Floating launcher window

`createFloatingLauncherWindow()` in `electron/main.ts`, modeled after `createFloatingAgentWindow`:

- Frameless, transparent, `vibrancy: "hud"`, `alwaysOnTop`, `skipTaskbar`, `resizable: false`.
- Width 720, height auto-grown by content.
- Loads the renderer with `?popout=launcher`.
- Hides on blur; re-shows on next trigger.
- Position: remembered last position, fallback to centered above current screen's cursor.

`app/main.tsx` dispatches `?popout=launcher` to a new `LauncherPopout` component (mirror of `AgentPopout`).

### 3. `GlobalSessionLauncher` React component

Lives at `app/components/launcher/GlobalSessionLauncher/`. Reuses heavily:

- `ChatInputShell` from Peacock for the input chrome (or extends it).
- `ProjectPicker` — already exists, extracted to a popover.
- `ModelPicker` — already exists.
- `FileMentionPicker`, `useMentionPicker` — work per-session, gated to "existing session selected".
- `ImageAttachmentStrip`, `filesToPendingImages`, paste/drag handlers — copy from `StartAgentDialog`.
- New: a `SessionPicker` popover (list sessions for selected project + "None — root agent" + "New session…").
- New: a draggable handle area (CSS `-webkit-app-region: drag` on the body, `no-drag` on inputs/buttons).
- When user picks "New session…", switch the inline form to the branch-off flow (description, optional branch name, source branch dropdown) — refactor the inner form of `CreateSessionDialog` into a reusable subcomponent so launcher and dialog share it.

### 4. "None — run in project root"

Argus models project-level agents as a session of kind `org_host`/host (per memory: "Org tasks are sessions"). Verify whether each project already has a host session; if not, the backend creates one on demand. New IPC: `get_or_create_root_session(repoRoot) -> SessionEntry`. Implementation lives in `electron/services/session/manager.ts`.

### 5. Area screenshot

New IPC: `start_area_capture()`.

Flow:

- Main process opens a transparent, fullscreen, click-through-disabled `BrowserWindow` for **each** display (`screen.getAllDisplays()`), `?popout=area-capture&displayId=...`.
- Renderer: black 30% backdrop, listens for `mousedown`/`move`/`up`, draws a marquee, returns the rectangle in screen coords on submit.
- Main process: `desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: displayWidth, height: displayHeight } })`, crops the rectangle, returns a base64 PNG.
- Returned image is attached to the launcher's `pendingImages`.
- Esc anywhere cancels.

The launcher window stays open behind the overlay (`alwaysOnTop` lowered while capturing, restored on dismiss).

### 6. IPC additions (in `electron/services/<domain>/` + `electron/ipc.ts` + `src/lib/ipc.ts`)

- `launcher_show` — main → renderer event when bridge fires.
- `launcher_hide`.
- `start_area_capture` → returns `ImageAttachment | null`.
- `get_or_create_root_session(repo_root)` → `SessionEntry`.
- `hotkey_set_enabled(enabled)`.
- `hotkey_status()` → `{ enabled, accessibilityGranted }`.

### 7. Settings

`app/stores/settingsStore.ts` + `SettingsDialog`:

- **Global launcher** section
  - Enable double-press right Option (default: on)
  - Fallback shortcut (default: `Cmd+Shift+Space`, configurable; uses `globalShortcut`)
  - Button: "Open System Settings → Accessibility" if permission missing.

Documented in `docs/app-settings.md`.

### 8. Files added / changed

New:

- `native/argus-hotkey-bridge/{Makefile,main.swift}`
- `electron/services/hotkey/{bridge.ts,index.ts}`
- `electron/services/session/rootSession.ts` (or extend `manager.ts`)
- `electron/services/areaCapture/{overlay.ts,capture.ts}`
- `app/components/launcher/{GlobalSessionLauncher,LauncherPopout,SessionPicker,AreaCaptureOverlay}`
- `app/components/launcher/sharedBranchOffForm.tsx` (extracted from `CreateSessionDialog`)
- Peacock additions if needed (a draggable window chrome wrapper)

Changed:

- `electron/main.ts` — `createFloatingLauncherWindow`, `createAreaCaptureWindows`, hotkey service init.
- `electron/preload.ts` / `app/lib/types.ts` — new event types.
- `app/main.tsx` — route `?popout=launcher` and `?popout=area-capture`.
- `app/components/sidebar/CreateSessionDialog/CreateSessionDialog.tsx` — refactor branch-off form into shared.
- Settings store + dialog screen.
- `package.json` `ensure:bridge` script and `build:bridge` to also build the hotkey bridge.

### 9. Risks / open questions

- **Accessibility permission UX.** First launch will prompt the user. Need a clear in-app explainer + button to retry after granting.
- **Right Option detection across keyboard layouts** — `keyCode 61` is Right Option on Apple keyboards; PC keyboards plugged in via USB can fail. Solution: also accept the `NSEventModifierFlagOption` flag with `event.modifierFlags & .deviceIndependentFlagsMask` filter for the right-side bit (`0x40` raw flag).
- **Multi-display area capture.** Need to spawn one overlay per display _and_ coordinate which one owns the marquee. Workable but fiddly.
- **Branch-off form reuse.** `CreateSessionDialog` is monolithic (1100 lines). Extracting just the branch-off form is doable but touches a high-traffic component — needs care.
- **`org_host` root session semantics.** Need to confirm a "host" session can run an arbitrary user-typed prompt the same way a worktree session can — it should, but worth verifying with the backend agent service.

## Suggested staging

Big enough that one PR is risky. Proposed:

1. Branch-off form extraction + new `get_or_create_root_session` IPC. (Backend + small refactor; non-visible.)
2. Floating launcher window + `LauncherPopout` UI _without_ global hotkey — open via menu item `Cmd+Shift+Space`. Project / session / new-session / submit all working. No screenshot.
3. Area-capture overlay.
4. Native `argus-hotkey-bridge` + double-press detection + Settings UI.

Each stage is mergeable on its own.
