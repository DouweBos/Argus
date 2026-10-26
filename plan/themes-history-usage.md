# Themes, imported chat history and Claude usage

Four features that make Argus feel at home for people who already live in
Claude Code: colour themes, chats from the plain `claude` CLI showing up in
Argus automatically, the projects behind those chats discoverable in one
click, and a Usage screen for plan limits, tokens and estimated cost.

## What exists today

- **Theme**: `dark | light | system` only (`app/stores/themeStore.ts`, host
  `AppSettings.theme`, Mac `HostPreferences`, iOS phone-local). One fixed amber
  accent in `tokens.css` and `Theme.swift`.
- **Limits**: rate-limit _detection_ only (`claudeAuth/accounts.ts`,
  `limitResume.ts`). Nothing reads plan utilisation. Peacock `UsageMeter`
  exists and is unused.
- **Cost**: per-agent `total_cost_usd`; no aggregate, no token totals.
- **History**: Argus saves its own chats (`chatHistory.ts`) and can
  `--resume` them. Nothing reads `~/.claude/projects`.

## 1. Colour themes

A colour theme is an accent plus a faint surface tint, defined for both dark
and light, layered on top of the existing scheme picker.

- Presets: Amber (today's look, default), Grove, Ocean, Ember, Iris, Rose.
- Peacock: `html[data-color-theme="…"]` blocks in `tokens.css` overriding the
  accent family and the canvas/sidebar/surface tints, dark + light. A
  `ThemePresetCard` component (swatch pair + label, selected state) with a
  story; the token story documents every preset.
- Desktop: `colorThemeStore` sets `data-color-theme`, mirrored to the host
  as `AppSettings.color_theme` like `theme`. Picker in Settings → Appearance.
- Mac: `Theme` gains per-preset accent/tints; `HostPreferences` binds
  `color_theme`; picker in General settings.
- iOS: phone-local preference (same as the scheme picker today), picker in
  Settings, `Theme.resolved(for:colorTheme:)` shared from ArgusUI.
- Telemetry: `color_theme_changed { theme, source }` from the host when the
  setting changes; iOS `ios_color_theme_changed { theme }`.

## 2. Claude usage: plan limits

- Host `services/claudeUsage/limits.ts`: per Claude account, start the CLI
  in stream-json mode under that account's config dir with a prompt that never
  arrives, send the `initialize` and `get_usage` (`skip_behaviors`) control
  requests, then kill it. No API request is made and Argus never touches
  the OAuth token. Map `five_hour` → Session, `seven_day` → Weekly, scoped
  weekly limits (`model_scoped`, else `limits[]` `weekly_scoped`) → "Weekly ·
  <model>", enabled spend/extra usage → Monthly spend. Cache 60 s.
- Live `rate_limit_event` lines from running agents (utilisation 0–1, reset in
  epoch seconds) update the matching window between probes.
- Pace: elapsed share of the window vs used share; >5 points over is "ahead",
  > 5 under is "under", otherwise "on pace".
- Command `get_claude_usage_limits` (admin) + remote `usage.limits` (monitor).
- UI: Usage screen (route `/usage`), Limits tab built from `UsageMeter` with
  "resets in …" and the pace hint. Mac: Usage window; iOS: Usage screen.
- Telemetry: `usage_limits_fetched { success, window_count }`, plus the
  screen-view path each client already has.

## 3. Claude usage: tokens and cost

- Host `services/claudeUsage/transcripts.ts`: every `*.jsonl` under
  `~/.claude/projects` touched within the window (+36 h), lines containing
  `"usage"` only, `type == "assistant"` records with a real `message.model`.
  Dedupe by `message.id:requestId` across the whole scan (the CLI repeats the
  usage object per content block and copies records on resume/fork).
  Incremental per-file byte offsets, cached in memory.
- Prices come from the public LiteLLM model price list
  (`model_prices_and_context_window.json`), cached in the Argus home for 24 h
  with a stale fallback: input, output, cache read, cache write (missing →
  input rate). Model keys are lowercased with `[1m]`-style suffixes stripped.
  Unknown models count tokens but no cost.
- cost = uncached·input + cache read·read + cache write·write + output·output;
  cache savings = cached input · (input − cache read).
- Range: 24 h (hourly), 7 d, 30 d (default), 90 d (daily, local time zone).
  Totals (processed, cached, uncached, output, savings), per-model breakdown,
  series, tokens/cost by type.
- Command `get_claude_usage_summary { range }` + remote `usage.summary`.
- UI: Cost / Tokens tabs on the Usage screen (`SeriesChart`, `StatsStrip`, a
  breakdown table). Mac + iOS show the same numbers.

## 4. Chats from the Claude Code CLI

- Host `services/externalChats/`: for each registered project, read
  `~/.claude/projects/<slug(repo root)>/*.jsonl` from the last 30 days, skip
  sidechains / meta / compact summaries, title = custom title → AI title →
  first user line. Keep the last 200 text messages, no tool calls.
- Import into the existing chat history (`chatHistory.ts`) tagged
  `importedFrom: "claude_code"`, keyed by the CLI session id (idempotent;
  re-imported when the file grows). Never touches sessions Argus itself ran or
  is running. Imports never evict Argus's own chats.
- Automatic: on boot, when a project is added, and every 10 minutes. App
  setting `import_cli_chats` (default on) + an "Import now" button.
- Resuming an imported chat from a worktree session copies the CLI transcript
  into that worktree's project dir first (`--resume` looks up by cwd).
- Desktop / Mac / iOS: an "Imported" badge on history rows (the phone already
  lists history; it just gains the badge).
- Telemetry: `cli_chats_imported { trigger, imported_count_bucket, project_count }`.

## 5. Projects from Claude Code history

- Command `scan_cli_projects`: group every `~/.claude/projects/*/*.jsonl` by
  its recorded `cwd`; keep existing git repos that aren't the home dir, temp
  dirs or linked worktrees; report chat count, last active, already-added.
- Desktop: "Import from Claude Code" in the add-project menu / home screen
  opens a checklist (default-selected: ≥3 chats in the last 30 days); import
  registers the projects, which triggers the chat import from §4.
- Mac: the same sheet. iOS: skipped — adding projects is host-machine local
  (path browsing) and the phone has no add-project surface today.
- Telemetry: `cli_projects_scanned { candidate_count_bucket, truncated }`,
  `cli_projects_imported { count }`.

## Deliberately skipped

- Codex history import and multi-provider usage — Argus only runs Claude Code.
- Custom theme editor / theme files / VS Code theme import, contrast and glass
  sliders, diff colour schemes, chat width, panel animations — worth doing
  later; presets first.
- Onboarding wizard rework (connect computers → agents → projects): Argus's
  onboarding already covers prerequisites; §5 adds the project step on its own.
- Reset-credit claiming and price overrides.
- Keybindings editor, browser/recording settings, storage cleanup rules,
  "settled" thread lifecycle — separate features.
