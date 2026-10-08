# Code editor — a native Code panel for the Mac app

A fourth session view next to Home / Agents / Git in `ArgusDesktop` (⌘4). You
read, navigate and lightly edit the files your agents are working on, without
leaving Argus. **It is not an IDE.** Argus is agent-first: the editor exists to
review and steer agent work, so every feature here has to earn its place
against "open it in Xcode/VS Code", which stays one click away.

## 1. What went wrong last time (`042d55c99`)

The Electron editor wasn't Monaco wired up by hand. It was the whole VS Code
workbench, embedded through `@codingame/monaco-vscode-api`: 78 packages, about
50 service overrides, 5 web workers, two CSP-bypassing URL schemes, the open-vsx
gallery, and the user's local VS Code extensions loaded as web workers. It
offered tabs, a file tree, ⌘P, workspace search, TextMate highlighting for about
21 languages, a minimap, and ⌘-click from chat to `path:line`. It had **no LSP**
(TextMate grammars only), **no git gutter**, and **no external-change handling**
(`watch()` was a no-op).

Why it failed, and the rule we take from each:

| Failure | Evidence | Rule for this plan |
|---|---|---|
| Highlighting failed silently. There were five failure modes (no language, no grammar, theme without tokenColors, worker crash, colour overrides), which `92e0aa739`/`71542ae86` only logged | `[syntax-highlight-debug]` logging | Tokenise in-process with no workers, URL schemes or bundler involvement. Every grammar and query is compiled in a unit test. A file without a grammar *says so* in the status bar and in telemetry |
| The library took over the global DOM: it clobbered `body` (`4140d5a39`), swallowed right-click (`0bf3bbe5c`), Space and ⌘W (`4aced4552`), and `beforeunload` cancelled quit | workarounds in `main.ts`, preload | Own a small view. Keys route through the app's existing `Commands` and focus, never a library's global handlers |
| A mount-order race when opening a file at a line (`4423e48a0`, a 5 s promise timeout) | `openFileInEditor` | Opening a file at a line is a **route**, rendered by state. There is no imperative "open after mount" |
| Stale caches across sessions, patched by poking private fields (`12656bb1f`) | `refreshFileSearchIndex` | Switching session is an explicit state reset. All per-session state is keyed by session id |
| The palette was hand-copied into `colorCustomizations` (`87b28087f`) and syntax colours were never mapped | `vscodeSetup.ts` | Syntax colours are design tokens in `ArgusUI`'s `Theme.swift`, the same source every other colour comes from |
| Absolute-path file IO could escape the worktree through symlinks (`e935c77c9`) | `read_path`/`write_path` | Session-relative IO only, through `resolveContainedPath` |
| Weight: about 1,200 lockfile lines, COEP headers, and React blocked behind 50 services | `package.json` | We add a small number of Swift packages and nothing to the renderer |

## 2. Editor engine — **CodeEditTextView behind our own `EditorView` facade**

**Recommendation.** Build `ArgusDesktop/Code/Editor/` on
[CodeEditTextView](https://github.com/CodeEditApp/CodeEditTextView) (MIT). It is
only the text-layout layer of CodeEdit: line-based, lazy CoreText layout built
for large documents, with no grammar dependency. It is wrapped in an
`NSViewRepresentable` the same way `Git/Diff/DiffTableView` is. On top of it we
build our own chrome:
- a gutter with line numbers, git marks and diagnostics;
- a find bar;
- a completion popover;
- a hover card.

We have to build that chrome anyway, because the git and diagnostic gutter and
the "ask the agent" affordances are Argus-specific. Pin an exact version, the
way SwiftTerm is pinned.

**Why not the alternatives:**
- **CodeEditSourceEditor.** Its own README says it is not ready for production.
  It also pulls in CodeEditLanguages, a macOS-only grammar bundle. That would
  give us a second, unshareable copy of the grammars next to the one the phone
  needs (see §3).
- **STTextView.** TextKit 2 with a good line-number ruler, but GPLv3 or a paid
  commercial licence (Argus is `UNLICENSED`). It is also macOS-only, and
  TextKit 2's estimated-height scrolling is jumpy on large files. It is the
  **named fallback** if the M0 spike shows CodeEditTextView can't meet the
  budget; the licence is cheap.
- **Runestone.** UIKit only, so on macOS it would only run through Catalyst.
- **A custom TextKit 2 view.** Months of work on layout, IME and accessibility
  before we have even one feature.
- **WKWebView + CodeMirror 6.** Rejected. It brings back exactly the web layer,
  bundling and theme duplication that §1 says to avoid.

**The facade (`EditorView` / `EditorDocument`)** exposes only what Argus uses:
- text and versioned edits;
- selection and scroll-to-line;
- decorations (syntax runs, gutter marks, diagnostic squiggles, flash
  highlights);
- an undo group API.

Nothing outside `Code/Editor/` imports CodeEditTextView, so swapping the engine
touches one directory.

**iOS sharing.** The editing view stays Mac-only. The phone gets a read-only
viewer (§7) built from `ArgusUI` primitives. What both platforms share is the
**highlighter** (§3), which is where the real cost of a code view lies.

## 3. Syntax highlighting — tree-sitter in a new `ArgusSyntax` package

- **Package.** `clients/apple/ArgusSyntax` targets iOS 18 and macOS 15 and has
  no UI. It depends on
  [SwiftTreeSitter](https://github.com/tree-sitter/swift-tree-sitter) (BSD-3)
  and on the grammars' own SPM packages (most official tree-sitter grammars ship
  a `Package.swift`). This is the first third-party dependency in the shared
  packages, so it lives in its own package. That keeps ArgusKit, ArgusCore and
  ArgusUI dependency-free, and lets only the targets that highlight pay its
  compile cost.
- **API.**
  - `SyntaxDocument(language:, text:)` parses incrementally. `edit(range:, newText:)`
    feeds tree-sitter `InputEdit`.
  - `highlights(in: visibleRange) -> [SyntaxRun]` runs highlight queries only on
    the visible range plus a margin.
  - `Language.detect(path:, firstLine:)` uses the extension, the file name
    (`Podfile`, `Dockerfile`, `Gemfile`, `*.gradle.kts`) and the shebang.
- **Parsing off the main actor.** Reparse runs on a background actor and is
  debounced per keystroke batch. If tree-sitter is slower than one frame, the
  edit shows immediately with stale colours and is recoloured on completion,
  never blocking typing.
- **Queries.** Vendor each grammar's `queries/highlights.scm` (plus
  `injections.scm` where it matters) into `ArgusSyntax/Resources/queries/<lang>/`,
  with a `LICENSES.md`. Rewrite them to a **small Argus capture vocabulary**:

  ```
  keyword  string  comment  type  function  number  constant  variable
  property operator punctuation tag  attribute  escape  regex  heading  link
  ```

  Unknown captures fall back by stripping suffixes (`keyword.return` becomes
  `keyword`), else they stay plain. Don't take nvim-treesitter's queries
  verbatim; they rely on Lua-only predicates.
- **Theme.** Add `syntax*` colours (one per capture above) to
  `ArgusUI/DesignSystem/Theme.swift`, in both dark and light, so the Mac
  editor, the iOS viewer and chat code blocks all draw from them. Editor chrome reuses existing tokens: background `bgPrimary`, current
  line `bgSecondary`, selection is an accent at reduced opacity, and gutter
  marks use `success`/`warning`/`error`.
- **Making failures visible** is the lesson from §1:
  - `ArgusSyntaxTests` compiles every bundled query against its grammar.
  - A golden test highlights one fixture file per language and snapshots the
    capture runs.
  - At runtime, a missing grammar shows "Plain Text" in the status bar and fires
    `mac_editor_highlight_unavailable`.
- **Guards.** Files over 2 MB, or with any line over 20k characters (minified
  bundles), open with highlighting off and a one-line notice.

**Languages, first wave (M1):** Swift, TypeScript, TSX, JavaScript, JSON,
Markdown (block and inline), Kotlin, Java, Objective-C (C headers through the
same grammar), YAML, Bash/shell, CSS, HTML, Python, Ruby, Go, Rust. That covers
the mobile stacks Argus targets plus the usual config and backend neighbours.
Measure the binary-size cost in M0; the budget is ≤ 15 MB for all of them. If
it goes over, drop Go/Rust/Ruby to a second wave.

**Injections (M2):** fenced code in Markdown, `<script>`/`<style>` in HTML, and
template literals stay plain. The same highlighter then colours **chat code
blocks** on Mac and iOS (`MarkdownView.CodeBlockView` and
`TranscriptMarkdown.codeBlock` are plain monospaced today). That is a cheap,
visible win from the same work.

## 4. Language intelligence — the host owns LSP and serves typed commands

**Where servers run.** In the **host** (`packages/host/src/services/lsp/`), one
server per (session worktree, language), spawned with the worktree as root.
This reuses what the host already does for agents and terminals, and it means a
remote Mac attached over the gateway gets intelligence without running anything
locally.

**The host is the LSP client, not a byte pipe.** The host speaks LSP to the
servers (`vscode-jsonrpc` + `vscode-languageserver-protocol`, which are mature
npm packages). Clients call **typed catalog commands** instead of proxying raw
JSON-RPC over the socket. Reasons:
- There is one LSP client implementation, in TypeScript, not one per client.
- Document sync, capability negotiation, server crashes and restarts are handled
  once, in one place.
- Commands get tiers, scope rules and telemetry like everything else. A raw
  `lsp_write` pipe would be an unscoped way to execute anything on the host.
- The terminal-style raw subscription (`terminal:data:<id>`) remains available
  if we ever need it. We don't for these features.

**Document sync.** While a file is open the editor owns its buffer:
- The client sends `lsp_did_open` with the full text and `lsp_did_change` with
  incremental, versioned edits.
- Positions are **UTF-16**, which is LSP's default and also `NSString`'s native
  unit, so there is no conversion on the Mac.
- For files the editor doesn't have open, the host sends
  `workspace/didChangeWatchedFiles` when agents write them. It derives this from
  the file watching in §5, so diagnostics stay current while an agent edits.

**Servers and discovery.** A table in `lsp/servers.ts` maps each language to its
candidates, tried in order. The host resolves `PATH` the same way the agent
service already does for agent subprocesses.

| Language | Server | Source |
|---|---|---|
| TS/JS/TSX | `typescript-language-server` | **bundled** in `dist-host`. Uses the worktree's `node_modules/typescript`, falling back to the bundled `typescript` |
| JSON, CSS, HTML | `vscode-langservers-extracted` | **bundled** (small). JSON gets schemas for `package.json` and `tsconfig` |
| YAML | `yaml-language-server` | **bundled** |
| Swift | `sourcekit-lsp` | toolchain, via `xcrun --find sourcekit-lsp` |
| Objective-C / C | `clangd` | toolchain, via `xcrun --find clangd` |
| Kotlin | JetBrains `kotlin-lsp` | `PATH` only. Pre-release, heavy on Gradle projects; opt-in in M4 |
| Python / Go / Rust / Ruby | `pyright-langserver` / `gopls` / `rust-analyzer` / `ruby-lsp` | `PATH` only (M4) |

Nothing is auto-downloaded in v1. When a server is missing, the status bar
reports it and offers a single "How to install" link to the docs.

**Lifecycle.**
- **Start:** lazily, on the first open document of that language in that
  session.
- **Reference counting:** by open documents across all connections, released
  through `onConnectionClose`.
- **Stop:** shut down after 10 minutes with no open documents. Kill on
  `session:deleted`, using a bus sink as `automation/outcomes.ts` does, and on
  `shutdownHost`.
- **Global cap:** 6 live servers, evicting the least recently used. tsserver per
  worktree is the memory risk, since five sessions would mean five tsservers.
- **Crashes:** restart with backoff, at most 3 times in 5 minutes. After that
  the server is marked failed until the user clicks Retry.

**Features, phased realistically:**
- **M3:** diagnostics, hover, go to definition (⌘-click and ⌃⌘J), and
  completion (trigger characters plus ⌃Space, with resolve on select).
- **M4:** find references, rename (`WorkspaceEdit`), format document and format
  on save, code actions and quick fixes, signature help.
- **Not planned:** semantic tokens (tree-sitter is enough), inlay hints, call
  hierarchy, debugging.

**Swift, honestly.** sourcekit-lsp works well for SPM packages. For `.xcodeproj`
and `.xcworkspace` apps it needs build settings from a build server
(`xcode-build-server` or BSP). Without that, Swift support in those apps will be
weak: highlighting yes, cross-file intelligence no. Many Argus users are in
exactly this case. M3 ships SPM support and spikes the Xcode-project path
separately; we don't promise it in v1.

## 5. Files

**Layout of the Code panel.** From left to right:
- A **navigator** (collapsible) with two modes:
  - **Changes**, the default: files the session has modified, from the existing
    `session:diff-changed` stats and git status. This is what you'll open 80% of
    the time in an agent workflow.
  - **Files**: a tree built client-side from `list_session_files` (git-tracked
    plus untracked-not-ignored), refreshed on `git_status_changed`.
- The **tab bar** and editor.
- The terminal split below, unchanged.

**Tabs, with a preview tab.** Single-click opens a reusable italic "preview" tab;
editing or double-clicking pins it. Tabs are per-session, persisted like the
existing `persistTabs()`, and capped at 20, closing the oldest clean tab first.
The *active file and line* live in the route (§5.1), so back and forward work.
The tab list itself is view state, not a route.

**Quick open (⌘P).** A fuzzy matcher over `list_session_files`, cached per
session and invalidated on `git_status_changed`. Changed files rank first. The
matcher is pure Swift in `ArgusCore` (shared with the phone and unit-tested). It
does not live in the host, because typing latency matters more than CPU here.

### 5.1 Route

`DesktopRoute.sessionCode(id:, path: String?, line: Int?)` maps to
`/sessions/:id/code?path=&line=`. The changes this needs:
- Add `SessionPanel.code` with the title "Code". The `NavigationCommands` loop
  gives it ⌘4 for free.
- Update `remember()` so it recalls the last file per session.
- Update the `.help` string to read "⌘1–⌘4".
- Add the route to `docs/routing.md`.

Opening a file at a line from anywhere is a single `navigate(.sessionCode(…))`
call, rendered declaratively. That rules out the mount race from §1.

### 5.2 Host commands (new `code` catalog domain)

`read_file` and `write_file` stay as they are for their current callers. The
editor gets versioned variants:
- **`code_read_file {id, relativePath}`** returns
  `{content, hash, mtimeMs, size, eol, readOnlyReason?}`. It keeps the 5 MB,
  binary and UTF-8 checks. Instead of throwing, it returns `readOnlyReason`
  (`too_large`, `binary`, `encoding`) so the UI can offer "Open externally".
- **`code_write_file {id, relativePath, content, baseHash}`** returns
  `{ok: true, hash, mtimeMs} | {ok: false, conflict: {hash, mtimeMs}}`. The
  write is atomic (temp file plus rename, as `writeFileBytes` does), preserves
  the file mode, and refuses when the file on disk ≠ `baseHash` unless
  `force: true`.
- **`code_watch_files {id, paths}` / `code_unwatch_files`** watch only the open
  files: `fs.watch` per file's parent directory, deduplicated, reference-counted
  per connection. That is never a recursive watch, because of EMFILE on large
  monorepos, the reason `session/watcher.ts` polls. The event is
  `code:file-changed:<sessionId>` with `{relativePath, hash | null, mtimeMs}`,
  where `null` means the file was deleted. Debounce 100 ms; the hash is SHA-1 of
  the content.

### 5.3 External changes — agents editing the same file

Agents write files in this worktree constantly, so this is the core flow, not an
edge case.

- **Buffer clean, file changed on disk.** Reload in place, keeping the caret and
  scroll by mapping through a line diff of the old and new text. The changed
  lines **flash** briefly in the agent accent, which gives you "show agent edits
  live" for free. The reload is recorded as one undo group, so ⌘Z returns to
  your pre-reload view (that makes the buffer dirty, which is correct).
- **Buffer dirty, file changed on disk.** Show a non-modal banner, "Changed on
  disk by an agent", with three choices:
  - **Compare**, which opens the existing `DiffTableView` with disk on the left
    and the buffer on the right;
  - **Keep mine**;
  - **Reload**.
  
  Saving in this state returns `conflict`, which shows the same banner. There is
  never a silent overwrite.
- **File deleted on disk.** The tab shows a strikethrough. Saving recreates the
  file.
- **An agent is mid-turn on a file you're editing.** Nothing locks; we don't
  pause agents. The banner is enough, and the hash check makes it safe.

**Save, dirty state and undo.**
- ⌘S saves the active file, ⌥⌘S saves all.
- Dirty state is a dot in the tab plus `NSDocument`-style edited state on the
  window.
- Undo is per document (the engine's undo manager) and is cleared on close.
- Closing a dirty tab, switching session or quitting prompts Save / Don't Save /
  Cancel.
- No autosave in v1. Autosave would race the agents.
- `.editorconfig` is honoured for indentation, final newline and trailing
  whitespace. A tiny parser in `ArgusCore` reads the files up the tree, through
  `code_read_file`.

## 6. Integration with the rest of Argus

- **Chat file links.** `TranscriptLinkHandler.openFile(ref)` navigates to
  `.sessionCode(id, path, line)` when the setting "Open file links in" is
  **Argus**, the default. Otherwise it uses `open_path`, as today. The context
  menu keeps Open In / Reveal / Copy Path and adds "Open in Argus". The `:line`
  part of a link finally works.
- **Git.**
  - `DiffTableView` rows and `BlameView` lines get "Open in Editor at Line"
    (context menu and ⌥-click).
  - Changes rows get "Open File".
- **Git gutter.**
  - The base text comes from GroveKit `fileContents(path:, revision: HEAD)`.
    That works for local sessions and, through `GatewayGitRunner`, for remote
    ones.
  - We diff it against the buffer with `CollectionDifference` over lines,
    debounced 300 ms after an edit and recomputed on `git_status_changed`.
  - Marks are added (`success`), modified (`warning`) and a deleted-lines
    wedge (`error`).
  - Clicking a mark peeks the hunk and offers **Revert hunk**, using the
    existing `discard_hunk`.
  - This needs no GroveKit API change (its `HunkData` start and count fields are
    internal anyway).
- **Find and replace in the file.** ⌘F / ⌥⌘F use an in-editor find bar, with
  regex, case and whole-word options and a match count. This is pure Swift over
  the buffer.
- **Search across the worktree** (⌘⇧F, M2):
  - The host runs **ripgrep**, bundled through `@vscode/ripgrep`'s darwin binary
    into the host staging (`build:mac-host`).
  - `code_search {id, query, regex, caseSensitive, wholeWord, include?, exclude?, maxResults}`
    returns `{searchId}`. Results stream as `code:search:<searchId>` batches,
    followed by `{done, count, truncated}`.
  - `code_search_cancel {searchId}` cancels.
  - It follows the git-runner progress pattern, with a new regex in the
    gateway's `rawSubscriptionScope`.
  - Results go to the navigator in a third mode, Search, grouped by file.
    Clicking one navigates to the route.
  - Replace across the worktree is M4. It reuses `code_write_file` per file
    with `baseHash`, so a file an agent touched mid-replace becomes a conflict,
    not a clobber.
- **Ask the agent.**
  - Each diagnostic (hover card, Problems list) gets "Ask agent to fix".
  - A selection gets "Send to Agent" (⇧⌘L).
  - Both **prefill** the active agent's chat input with
    `@path:line`, the diagnostic message and the selection, then focus it.
  - Neither auto-sends: the user sees what goes to the model.
  - With no live agent, they start one in the session using the default model.
- **Problems list.** This is a footer strip in the Code panel: the count by
  severity, which expands to a list for the open files. Workspace-wide
  diagnostics are M4.
- **Later, not v1:** expose `lsp` diagnostics to agents as an MCP tool, so an
  agent can check its own edits against the same server the user sees.

## 7. iOS

This plan targets the SwiftUI apps only. The Electron app gets no new features,
and nothing in `app/`, `electron/` or Peacock changes. Everything the editor
needs from the machine is a **host command**, so the SwiftUI clients (Mac,
remote Mac, phone) all reach it the same way.

- **iOS gets a read-only viewer in M1, in the same PRs.** It is a genuine phone
  use case: an agent says "I changed `Foo.swift:42`" and you want to see it.
  - `ArgusUI/Views/CodeView.swift` is a lazy, line-virtualised `List` of
    `AttributedString` lines with line numbers, coloured by `ArgusSyntax`. It is
    shared with the Mac where a read-only view is enough, such as the
    conflict-compare pane.
  - **Chat file links become tappable** on iOS (`FileLinks` is already in
    ArgusCore) and open the viewer at the line.
  - The Changes screen gets "View file" next to each diff card.
  - Quick open is a search field over `sessions.files`.
  - Worktree search on the phone comes in M2, since the host command exists by
    then.
- **What the phone does not get, with reasons:**
  - **Editing.** A phone keyboard is the wrong tool for code. Agents racing your
    edits are worse on a device you glance at. And the write path would be the
    first control-tier method that writes arbitrary file content, a real
    security escalation for a paired phone.
  - **LSP.** Hover and completion need a pointer and a keyboard.
- **New remote methods:**
  - `files.read` returns the same result as `code_read_file`.
  - `files.search` (M2).
  - Both are **`control` tier**, with `session()` scope. Reading file contents
    is more sensitive than the transcript, and it matches the existing
    `sessions.files`.
  - Gate the UI on `app.hasControl`.

## 8. Protocol, telemetry, settings

### Catalog (`packages/remote-protocol/src/commands/code.ts`, `models/code.ts`)

| Command | Tier | Phase |
|---|---|---|
| `code_read_file`, `code_write_file`, `code_watch_files`, `code_unwatch_files` | admin | M1 |
| `code_search`, `code_search_cancel` | admin | M2 |
| `lsp_did_open`, `lsp_did_change`, `lsp_did_close`, `lsp_completion`, `lsp_completion_resolve`, `lsp_hover`, `lsp_definition`, `lsp_status`, `lsp_restart` | admin | M3 |
| `lsp_references`, `lsp_rename`, `lsp_format`, `lsp_code_actions`, `lsp_execute_code_action`, `lsp_signature_help` | admin | M4 |

**Events:**
- `code:file-changed:<sessionId>`
- `code:search:<searchId>`
- `lsp:diagnostics:<sessionId>`, with `{relativePath, version, diagnostics}`
- `lsp:status:<sessionId>`, with server state per language: starting, ready,
  missing, failed

**Models** are a strict, documented subset of LSP shapes: `Position`, `Range`,
`TextEdit`, `CompletionItem`, `Diagnostic` and `Location`, with paths made
**session-relative** by the host. The host rewrites the server's `file://` URIs
and drops any location outside allowed roots.

**Remote methods:** `files.read` and `files.search`, wired with `capabilities.ts`
and `scope.ts` entries and an `Envelopes.swift` case. Run `pnpm gen:protocol`
after each catalog change.

### Telemetry

These events carry no paths, contents, queries, symbol names or messages.
`language` is an enum of the bundled grammars plus `other`.

| Event | Where | Props |
|---|---|---|
| `mac_editor_file_opened` | Mac | `source` (chat_link, diff, blame, changes, tree, quick_open, search, diagnostic, history), `language`, `size_bucket`, `read_only` |
| `mac_editor_file_saved` | Mac | `formatted`, `had_conflict` |
| `mac_editor_conflict_resolved` | Mac | `action` (compare, keep_mine, reload) |
| `mac_editor_external_reload` | Mac | `agent_running` (sampled: first per file per session) |
| `mac_editor_highlight_unavailable` | Mac | `language`, `reason` (no_grammar, too_large, long_lines) |
| `mac_editor_search_run` | Mac | `scope` (file, worktree), `regex`, `result_bucket`, `truncated` |
| `mac_editor_ask_agent` | Mac | `source` (diagnostic, selection), `started_agent` |
| `mac_editor_completion_accepted` | Mac | `language` |
| `lsp_server_started` | host | `language`, `source` (bundled, toolchain, path), `success`, `duration_bucket` |
| `lsp_server_crashed` | host | `language`, `gave_up` |
| `lsp_feature_used` | host | `feature` (hover, definition, references, rename, format, code_action), `language`, `success`. Completion is excluded because of volume |
| `ios_file_viewed` | iOS | `source` (chat_link, changes, quick_open, search), `language` |

Each event goes into `MacTelemetryEvent.swift`, `EventMap` in
`telemetryEvents.ts` (kept alphabetical) and `TelemetryEvent.swift`, and is
documented in `docs/telemetry-events.md`. `telemetryDocs.test.ts` enforces the
match. Errors go through the existing `log.error` and `fail(_:_:)` paths.

### Settings

App-level Mac settings live in `AppPreferences`, in a new **Editor** settings
tab, and are documented in `docs/app-settings.md` under the Mac app section.
- Font: SF Mono by default, any installed monospaced font. Size defaults to
  13, following `TextScale`.
- Tab width: 4 by default. Insert spaces: on. `.editorconfig` wins when it is
  present.
- Wrap lines: off by default.
- Show invisibles: off by default.
- **Minimap: not shipped.** It costs a second render pipeline for little value
  in review-centric use. Revisit only if people ask for it.
- Format on save: off by default; appears in M4.
- Open file links in: Argus (default) or default app.
- Language servers: a global toggle plus one toggle per language, with status
  shown from `lsp_status`.

Project-level settings (`ArgusConfig.languageServers`, overriding a server
command per language) come in M4 at the earliest, and only if users need them.
When they do, they go through `SetupConfigDialog` and `docs/project-settings.md`
as CLAUDE.md requires.

## 9. Milestones

**M0 — spike (about 1 week, throwaway branch).**
- Build CodeEditTextView plus an `ArgusSyntax` prototype for Swift, TS and
  JSON.
- **Accept when:**
  - a 50k-line TS file opens in < 300 ms;
  - typing latency p95 < 16 ms with highlighting on;
  - scrolling the whole file holds 60 fps;
  - IME (Japanese/Chinese input) and VoiceOver basics work;
  - the full first-wave grammar set adds ≤ 15 MB to the Mac app and compiles
    for iOS.
- If CodeEditTextView fails, repeat the measurements with STTextView and buy its
  licence.
- The outcome is recorded in this file.

**M1 — Code panel, read and write, no LSP.**
- **Scope:**
  - `ArgusSyntax` with the first wave of languages, plus the syntax tokens in
    `Theme.swift`;
  - the ⌘4 Code panel and route;
  - the navigator (Changes and Files), tabs with a preview tab, and ⌘P;
  - find and replace in the file;
  - the git gutter with revert hunk;
  - `code_read`, `code_write` and `code_watch`, with conflict handling and agent
    edit flashes;
  - chat, diff and blame links opening the editor at a line;
  - settings and telemetry;
  - on iOS, `CodeView`, tappable file links and "View file", over `files.read`.
- **Accept when:**
  - ⌘-clicking `Foo.swift:42` in chat lands on line 42 with highlighting, every
    time, with no retries;
  - an agent rewriting an open clean file updates the buffer within 300 ms and
    keeps the caret;
  - an agent rewriting an open dirty file never loses either side;
  - every bundled query compiles in CI;
  - `pnpm lint`, the `swift test` runs and both `xcodebuild` builds are green.

**M2 — search and injections.**
- **Scope:** bundled ripgrep, `code_search` with streaming results and ⌘⇧F; the
  `files.search` method on iOS; Markdown and HTML injections; highlighted code
  blocks in chat on both platforms.
- **Accept when:** searching a 200k-file monorepo streams its first results in
  < 500 ms and Cancel stops `rg`.

**M3 — LSP foundation.**
- **Scope:**
  - the host `lsp` service, its lifecycle and cap;
  - the bundled TS, JSON/CSS/HTML and YAML servers, plus sourcekit-lsp (SPM)
    and clangd from the toolchain;
  - diagnostics (squiggles, gutter, Problems strip), hover, go to definition
    and completion;
  - "Ask agent to fix" and "Send to agent";
  - a separate spike on the Xcode-project Swift path.
- **Accept when:**
  - a TS error introduced by an agent appears as a diagnostic in the open file
    without user action;
  - completion shows in < 200 ms (p95, local socket);
  - deleting a session leaves no orphaned server processes;
  - six worktrees never run more than six servers.

**M4 — deeper intelligence and more languages.**
- References, rename, format and format on save, code actions, signature help.
- Replace across the worktree.
- The PATH servers for Kotlin, Python, Go, Rust and Ruby.
- Workspace-wide problems.
- Optional per-project server overrides.

**v1 = M1–M3.**

### Risks

| Risk | Mitigation |
|---|---|
| CodeEditTextView is pre-1.0 and its API churns | Exact pin, the facade (§2), STTextView as the measured fallback |
| Grammar and binary size, iOS compile time | Measured in M0; a separate package so only the targets that highlight pay the cost; trim to a second wave if needed |
| Swift intelligence in Xcode projects | Promise SPM only; the build-server path is a separate spike |
| tsserver memory across many worktrees | Lazy start, idle shutdown, a cap of 6 with LRU eviction |
| Agent and user write races | Hash-checked atomic writes, a banner instead of a silent overwrite, no autosave |
| Watching too much (EMFILE) | Watch only open files, never recursively |
| Shortcut clashes (⌘P, ⌘F, ⌘S, ⌘W, Space) with existing Mac commands | Register through `Commands` with focused-scene values, so they're active only while the Code panel has focus |
| Highlighting silently breaking again | Compile tests and golden tests for every query, plus visible status and telemetry |

### Explicitly not in v1

- Split editors and multiple windows.
- Minimap.
- An extension or plugin system, VS Code themes or extensions.
- Debugging, a terminal inside the editor (the session terminal already exists),
  notebooks.
- Semantic tokens, inlay hints.
- Editing, LSP or search replace on iOS.
- Anything in the Electron app.
- Auto-installing language servers.
- Kotlin, Python, Go, Rust and Ruby intelligence (M4).
- Rename and references (M4).
- Binary or image previews: these offer Open externally.

## 10. Where the code changes

- **Host:** `packages/host/src/services/code/` (read, write, watch, search) and
  `services/lsp/` (manager, servers table, uri mapping). Commands are in
  `commands/code.ts` and `commands/lsp.ts`. Cleanup on `session:deleted` and
  `shutdownHost`.
- **Protocol:** `packages/remote-protocol/src/commands/{code,lsp}.ts`, plus
  `models/`, `messages.ts`, `capabilities.ts` and `scope.ts`; then
  `pnpm gen:protocol`.
- **Apple:**
  - the new package `clients/apple/ArgusSyntax`;
  - `ArgusUI/DesignSystem/Theme.swift` (syntax tokens) and
    `ArgusUI/Views/CodeView.swift`;
  - `ArgusCore` (fuzzy matcher, editorconfig, `FileLinks` reuse);
  - `ArgusDesktop/Code/` (panel, navigator, tabs, `Editor/` facade, gutter,
    find, LSP UI);
  - `App/DesktopRoute*.swift`, `DesktopModel+Navigation.swift` and
    `Shell/Session/SessionView.swift`;
  - `Shell/Transcript/TranscriptLinkHandler.swift`, `Git/Diff/*` and
    `Git/History/BlameView.swift`;
  - `Settings/EditorTab.swift`;
  - on iOS, `ArgusRemote` screens and stores (with pbxproj entries).
- **Docs:** `docs/routing.md`, `docs/app-settings.md`,
  `docs/telemetry-events.md`, and changesets per milestone (`argus` minor).

## Verification (per milestone)

- `pnpm lint`, `pnpm test` (host: the code and lsp services against a temp git
  repo, the conflict path, watcher reference counting, and LSP lifecycle with a
  fake stdio server).
- `swift test` in ArgusSyntax (query compile and golden snapshots), ArgusCore
  (fuzzy matcher, editorconfig) and ArgusUI.
- `xcodebuild … -scheme ArgusDesktop … test` and the iOS Simulator build.
- A manual pass in a **dev build** ("Argus Dev", `~/.argus-mac-dev`, launched by
  path, never touching the live Argus). Have an agent edit an open file, then
  check:
  - clean reload with a flash;
  - dirty-buffer banner and Compare;
  - ⌘-click a chat link to a line;
  - gutter marks and revert hunk;
  - (M3) a diagnostic, then Ask agent to fix, then the agent fixes it and the
    diagnostic clears.
