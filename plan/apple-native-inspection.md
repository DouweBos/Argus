# Apple-only native inspection

Restrict the device UI inspector to Apple platforms and re-point it from
`conductor capture-ui` (XCUITest a11y snapshot) to the new in-process
`conductor native-inspect` plane (dylib injected via `launch-app --inject`).

## Part 1 — Apple only

- `DevicePlatform` (inspection/types.ts): `"ios" | "tvos"` (drop android/web).
- Gate inspect mode in `RuntimeView` on `platform === "ios"` (iPhone/iPad/tvOS
  all run as iOS sims here). Snap back to simulate otherwise.
- Remove android/web branches in normalize + resolveNodeVisual + fixtures/tests.

## Part 2/3 — adopt native-inspect

- New contract in `types.ts` around the native node shape: `id` (opaque hex),
  `class`, `frame` (local), `absFrame` (window-absolute — box position + 3D
  plane), `depth`, `z`, `alpha`, `hidden`, colors (`#RRGGBBAA`), `font`, `text`,
  `title`, `rn`, layer visuals, `transform3D`, `children`. Screenshot optional.
- `normalize.ts`: collapse to one job — wrap `windows[]` into a root, defensive
  per-node coercion. No per-platform heterogeneity.
- `resolveNodeVisual.ts`: leaf = no children; visual `fill` uses real
  `backgroundColor`; positioning uses `absFrame ?? frame`. Opaque ids ⇒ ancestor
  expansion via a parent map, not id-path splitting.
- `store.ts`: drop a11y snapshot + focus (native-inspect has neither); keep
  hierarchy/search/renderer-mode.
- Renderers/metadata/search surface real colors (ColorSwatch peacock primitive),
  fonts, text, layer + RN info.
- Backend `capture.ts`: run `native-inspect` (+ `native-screenshot`), ping-check
  and return a clear "launch with --inject" error when the in-proc server is down.

## Removed (no native-inspect equivalent)

- Ordered accessibility snapshot: `A11yEntry`, `AccessibilityList`,
  `A11yBadgeLayer`, sidebar a11y tab. Follow-up: wire `/focus` + an a11y-order
  endpoint later.

## Runtime dependency

`native-*` commands only exist on conductor branch `ios-dylib-injection`.
Bundled conductor is pinned to 0.24.0 — the branch must be merged/released
before this works at runtime.

## 3D follow-up

`absFrame` + `depth` + `z` + per-node `native-snapshot` textures are the inputs;
`NodeVisual.image` seam is reserved for them.
