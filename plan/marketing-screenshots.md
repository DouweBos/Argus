# Agentic marketing screenshots

Generate every product image on houwert.dev/argus from a command, with no human
holding a mouse. An agent adds a scenario file and runs `pnpm shots`.

## Why not screenshot the real app

Capturing the live Electron app needs a Claude subscription, a booted simulator,
and a real repo — and produces different pixels every run. Real transcripts also
leak paths, repo names, and emails into marketing assets. Screenshots taken that
way rot silently: nobody notices the UI moved on.

Instead: boot the **real React app** in a plain browser against **recorded
fixture data**. Same components, same CSS, deterministic output, runnable in CI.

## The seam

Stub the **preload bridge**, not the transport. A `fixture.ts` alongside
`local.ts` / `remote.ts` looks tidier but misses `useIsFullscreen.ts` and
`updaterStore.ts`, which call `window.argus.on` directly and crash before the
transport layer is consulted. Installing a stand-in `window.argus` covers every
caller at once, and `localTransport` then routes to it unchanged.

`main.tsx` already parses `URLSearchParams` before booting, so
`?fixture=<scenario>` installs the shim before any store module loads.

No component, store, transport, or `app/lib/ipc.ts` change.

## Fixtures are authored, not recorded

**Changed from the original plan.** Recording a real session needs live Claude
auth, a real repo and someone driving the app, which rules it out for an
unattended run — and it captures far more than a scenario needs. Authoring the
scenario as typed data turned out cheap: `parallel.ts` is ~135 lines for the
whole home screen, and `tsc` catches drift from `Session` / `AgentStatus` on
the next refactor, which a JSONL log would not.

A scenario is a `FixtureScenario`: `channels` (IPC replies, canned or resolved
from the call's args), `events` (pushed after boot), and `storage` (the
`localStorage` a real install would already hold). Names and paths are
fictional — the demo project is "Aurora" under `/Users/dev/Projects/` — so
nothing real leaks into a published image. `NOW` is pinned so relative times
("4h ago") are stable.

Recording is still the right answer for an agent transcript, where the payload
volume is genuinely high. Worth building when that shot is wanted.

Device frames arrive over IPC locally (`transport.media` is remote-only), so
they land in the log as sidecar PNGs referenced by path — not inlined, or the
fixtures get huge. One still frame per device, looped, is enough for a
screenshot; keep the frame sequence with its original timing for video.

**Default-response policy matters.** `boot.tsx` fires a lot of init calls. An
unrecorded channel must resolve to `null`/`[]` and log — never reject — or half
the UI throws on the way up.

## Capture with conductor, not a new dep

`conductor` already has everything and is ours:

- `start-device --platform web` (Playwright chromium)
- `set-viewport --width --height --scale 2` for retina
- `take-screenshot [--full-page] --output`
- `assert-screenshot <ref.png> --threshold` for regression
- `record-video start/stop` for the hero loop

Zero new dependencies, and it dogfoods the CLI that Argus agents already drive.

`conductor debug evaluate` runs JS in the page context — that is how the runner
reads `data-shot-ready` and the error array, with no Playwright of its own.

**Pass `--device <id>` on every call.** With several simulators registered,
unscoped commands pick a non-web device and fail; `CONDUCTOR_DEVICE` is not
honoured. Vite dev serves on **1420**, not 5173.

## Determinism

- The fixture transport knows how many events a scenario replays. When the
  queue drains and React has flushed (two `requestAnimationFrame` ticks), it
  sets `document.documentElement.dataset.shotReady = "true"`. conductor waits on
  that attribute. **No `sleep`.**
- `?shot=1` adds a class that kills animations, transitions, and the caret blink
  — otherwise every diff is noise.
- Both themes captured every run. The no-hardcoded-colors rule in CLAUDE.md
  exists precisely so this works; light/dark pairs come free.

## Scenario catalog

`shots/scenarios/*.ts`, each exporting
`{ id, fixture, route, viewport, theme, crop? }`. The runner loops them:
open `http://localhost:1420/?fixture=<id>&shot=1#<route>`, wait for
`data-shot-ready`, write `shots/out/<id>@<theme>.png`.

First four map to the site's existing pillars in `houwert.dev/src/data/argus.ts`:

| Scenario                                     | Pillar                  |
| -------------------------------------------- | ----------------------- |
| Five sessions fanned out, mixed agent states | Parallel by default     |
| Live simulator + streaming tool-call cards   | See what the agent sees |
| Diff viewer mid hunk-level stage             | Review like a human     |
| Embedded VS Code, multi-file edit            | Edit like an engineer   |

## Delivery to the site

`shots/out/` → sharp (WebP + PNG fallback, 1x/2x) → `houwert.dev/public/argus/`
plus a `shots.generated.json` manifest, following the existing
`scripts/sync-changelogs.mjs` / `sync-argus-docs.mjs` pattern that already pulls
from this repo at build time. A `ProductGallery` component renders it between
`ProductHero` and `FeatureGrid`.

(houwert.dev is a separate repo on Tailwind — the Peacock rules don't apply
there.)

## Risks, in the order they should be resolved

1. ~~Does the app render in a plain browser tab at all?~~ **Answered: yes.**
   See "Findings" below.
2. **Embedded VS Code** (`@codingame/monaco-vscode-api`) may not boot outside
   Electron. If it fights, that one shot falls back to capturing the real app;
   don't block the other three on it.
3. Fixture size if frames get inlined — sidecar files from the start.

## Phases

- **0 — Spike:** done. `app/lib/fixture/stubBridge.ts` + the `?fixture=` branch
  in `main.tsx`.
- **1 — Fixture bridge:** done. Scenario registry, arg-aware resolvers, event
  push, `localStorage` seeding, theme override, motion freeze.
- **2 — Runner:** done. `pnpm shots` / `pnpm shots --check` (`scripts/shots.ts`).
- **3 — Scenarios:** `parallel` and `review` done, both themes. `agent` is
  written but **not registered** — see below. The embedded-editor scenario is
  cancelled: there is no embedded editor any more.
- **4 — Site:** done. `sync-argus-shots.mjs`, `ProductGallery`, rewritten copy.
  No image optimisation step: the 3200px PNGs land at ~220 KB, so WebP would
  save little and `sharp` is not a dependency here.
- **5 — CI:** not done. `pnpm shots --check` works locally but is not wired to
  a workflow; it needs a runner with conductor and a browser.

## Findings

The real onboarding screen rendered in a plain Chromium tab with no Electron, no
backend, no Claude auth, and no simulator. 17 IPC channels answered from
defaults, zero runtime errors.

What the spike changed about the plan:

- **`DEFAULTS` is mandatory, not a nicety.** An empty-everything bridge renders a
  blank page. Two channels gate the entire UI: `onboarding_get_state` (which the
  app polls in a loop) and `updater_get_state` — `UpdaterHost.tsx:41` reads
  `.phase` off it unguarded. Every channel added to a scenario needs its shape
  checked, not just its presence.
- **`main.tsx` swallowed the cause.** Its trailing `.catch(() => undefined)`
  eats anything `boot()` throws, so a failed boot and a successful empty render
  look identical — and `window.onerror` stays clean. Fixture mode now records
  boot failures to `window.__argusFixtureErrors`. Without this the spike would
  have been a guessing game.
- The shim records every channel it is asked for on
  `window.__argusFixtureCalls`. That list _is_ the coverage checklist for each
  recorded scenario.
  Then, building the scenario out:

- **Shapes have to be checked against the type, not guessed.** Two of the three
  bugs that cost the most time were wrong shapes that failed silently:
  `onboarding_get_state` returns `OnboardingConfigFile` (the state is nested
  under `.onboarding`, so a flat object leaves the app stuck on the welcome
  screen), and `argus:theme` holds a bare string, not JSON, so a
  `JSON.stringify`-ed value is ignored and the theme never switches.
- **Agents only reach the renderer as events.** `state_hydrate` is the remote
  path; locally nothing lists running agents, so a scenario has to push
  `agent:started` per agent. Hence `events` on the scenario.
- **`initTheme` had to move into the promise chain.** Both it and `initUiScale`
  read `localStorage` when their _module_ first evaluates, so a static import
  in `main.tsx` beat the fixture seeding. They are dynamic imports now.
- **`list_agents` is per-session**, so replies need the call's args — hence
  `FixtureResolver`. Note that `unknown | ((…) => …)` collapses to `unknown` in
  TypeScript and silently drops the parameter type; the resolver is cast at the
  use site instead.
- `conductor set-viewport` fails if the page is on a `chrome-error://` URL —
  set the viewport _before_ the first `open-link`, or after a successful one.

`pnpm shots --check` passing on a second run is the proof the whole thing is
deterministic: same pixels, twice, from a cold browser.

## The blocked scenario — resolved

It was never an app bug, and it was never in `getLastKnownCapabilities`.

**Vite serves transformed TSX, and `error.stack` is in the transformed file's
coordinates, not the source's.** Line 215 of the source is the
`getLastKnownCapabilities()` call; line 215 of the _served_ module is
`registeredRunners.find(...)`. Hours went into auditing the wrong expression.
The way to read one of these stacks is to fetch the served module and look at
that line:

```sh
curl -s http://localhost:1420/app/components/agent/AgentChat/AgentChat.tsx | sed -n '215p'
```

The actual causes were three fixture defaults, found one after another once the
stacks could be read:

- `llm_list_runners` has `list` in the _middle_ of the name, so the array
  heuristic missed it and `registeredRunners` came back null.
- `get_command_metrics` is a keyed map the chat indexes into, not a list.
- `claude_accounts_list` ends in `_list` but returns an **object** — the name
  heuristic actively got this one wrong, which is why explicit entries are
  checked before it.

What the scenario already proved out, and is worth keeping:

- `agent:started` registers an agent but never makes it active — the real app
  only does that on start or tab click — so `activeAgents` had to become part of
  the scenario.
- The startup has to run in strict phases (register → route + activate →
  stream), or the same scenario captures a different screen each run.
- Capabilities have to be seeded into `argus:last-capabilities`, not pushed as
  an event: the chat resolves its context window on first render.

## The payoff

The regression mode is the real win. Hand-taken marketing screenshots go stale
without anyone noticing; these fail the build when the UI moves.
