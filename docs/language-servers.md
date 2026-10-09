# Language servers

The code editor in Argus for Mac gets its diagnostics, hover, go to
definition and completion from language servers. They run on the machine
that hosts your sessions — so a Mac attached to another Argus over the
network gets the same intelligence without installing anything itself.

Argus starts a server the first time you open a file in that language in a
session, and stops it after ten minutes with no open files. At most six run
at once across all sessions; the one used least recently makes way. Deleting
a session stops its servers.

The status bar shows each server's state. **Not found** means the server
isn't installed; **Failed** means it crashed more than three times in five
minutes — click **Retry** once you've fixed whatever was wrong. A server
that **needs setup** wasn't started on purpose, because its answers would be
wrong — hover over it to see why (so far only Swift does this, see
[Swift](#swift)).

## Which languages, and where the server comes from

| Language                        | Server                                                          | Comes from                     |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------ |
| TypeScript, JavaScript, TSX/JSX | `typescript-language-server`                                    | Bundled with Argus             |
| JSON, CSS/SCSS/Less, HTML       | `vscode-json-language-server`, `-css-`, `-html-` (from VS Code) | Bundled with Argus             |
| YAML                            | `yaml-language-server`                                          | Bundled with Argus             |
| Swift                           | `sourcekit-lsp`                                                 | Xcode                          |
| C, C++, Objective-C             | `clangd`                                                        | Xcode                          |
| Kotlin                          | `kotlin-lsp` (JetBrains)                                        | Your `PATH` — install it first |
| Python                          | `pyright-langserver` (or `basedpyright-langserver`)             | Your `PATH` — install it first |
| Go                              | `gopls`                                                         | Your `PATH` — install it first |
| Rust                            | `rust-analyzer`                                                 | Your `PATH` — install it first |
| Ruby                            | `ruby-lsp`                                                      | Your `PATH` — install it first |

Argus never downloads a language server for you.

Open Quickly (⇧⌘O) and workspace symbol search (⌘T) work without any
server: Argus keeps its own index of the definitions in a session's files,
and merges in what a running server knows on top.

### Bundled servers

These ship inside the app and need nothing from you.

- **TypeScript and JavaScript** use the `typescript` package in your
  project's `node_modules` when there is one, so diagnostics match your
  build. Projects without it — or on TypeScript 7, which no longer ships the
  classic language service — use the TypeScript 6 that Argus bundles.
- **JSON** validates `package.json` and `tsconfig.json` against their public
  schemas, which it downloads from schemastore.org the first time.
- **YAML** picks up schemas from schemastore.org for files it recognises,
  such as GitHub workflows.

### Xcode servers

Swift and C-family files use the servers in your active Xcode toolchain (the
one `xcode-select -p` points at), found with `xcrun`. If you don't have Xcode,
Argus also looks for `sourcekit-lsp` and `clangd` on your `PATH`.

`clangd` reads `compile_commands.json` at the root of your project when there
is one.

### Swift

`sourcekit-lsp` only gives honest answers when it knows how your code is
built, so Argus looks at what each Swift file belongs to:

- **A Swift package.** Files under a `Package.swift` get a server rooted at
  that package, so a repository with several packages gets one per package.
  Diagnostics, completion and go to definition work across the package.
- **An Xcode project.** Files in a repository with an `.xcodeproj` or
  `.xcworkspace` (outside `Pods`, `DerivedData`, `node_modules` and `.build`)
  go through a build server — see below. Once xcode-build-server is
  installed, the app's local packages go through it too, since Xcode builds
  them for the app's platform. Without it, a local package still gets its own
  server unless it lists only iOS-family platforms (it would fail to import
  `UIKit` when built for the Mac).
- **A lone Swift file**, outside any package or project, runs in single-file
  mode. Several loose files in one folder don't: `sourcekit-lsp` can't see
  how they fit together and would report each other's types as missing. The
  status bar says **Swift: limited here**.

#### Swift in Xcode projects

On its own, `sourcekit-lsp` doesn't know an Xcode project's SDK, targets or
modules, so it reports errors like `No such module 'UIKit'` for code that
builds fine. Argus gets those build settings from
[xcode-build-server](https://github.com/SolaWing/xcode-build-server), which
reads them from your project's Xcode build logs. Until it can, Argus doesn't
start `sourcekit-lsp` for the project at all — highlighting, folding and
search keep working, and the status bar says what's missing:

1. **Swift: needs a build server** — install it, then click **Retry**:

   ```sh
   brew install xcode-build-server
   ```

   Argus finds it on your `PATH` or in Homebrew's usual places.

2. **Swift: build once to enable** — build the app once in this session,
   with its run command or in Xcode. xcode-build-server needs a build log
   for this worktree; a build in another checkout doesn't count. Argus
   notices the build by itself and starts Swift intelligence a few seconds
   after it finishes.

Then you get diagnostics, completion, hover, go to definition, references and
rename across the app and its local packages. Build again after adding files
or changing build settings; xcode-build-server picks up the new log on its
own.

To set things up, Argus writes a `buildServer.json` at the root of the
worktree, unless there already is one (or a `.bsp` folder) — then it uses
yours as it is. It keeps the file out of git through the repository's
`.git/info/exclude`, not your `.gitignore`. The file follows one scheme:

- the one your `xcodebuild` run command builds (`-scheme`), when it has one;
- else the shared scheme that builds an app and has the project's name;
- else the first scheme that builds an app, else the first scheme.

A `-derivedDataPath` in that run command is followed too. When Argus had to
pick among several schemes, hovering the status bar item says which. To
switch, delete `buildServer.json` and click **Retry**, or run
`xcode-build-server config -scheme <name>` in the worktree yourself.

### Servers on your PATH

Argus finds these the same way it finds `git` and your agents: on the `PATH`
your login shell sets up, so anything your terminal can run, Argus can too.
Install with your usual tool, then reopen the file (or click **Retry**):

| Language | Install                                                                                 |
| -------- | --------------------------------------------------------------------------------------- |
| Python   | `npm install -g pyright` or `pipx install basedpyright`                                 |
| Go       | `go install golang.org/x/tools/gopls@latest` (make sure `~/go/bin` is on your `PATH`)   |
| Rust     | `rustup component add rust-analyzer`                                                    |
| Ruby     | `gem install ruby-lsp`                                                                  |
| Kotlin   | `brew install JetBrains/utils/kotlin-lsp` (pre-release; heavy on large Gradle projects) |

## Formatting

Format Document (⇧⌥F) and format on save use the project's own formatter
first, the version installed in the worktree with the project's config, run in
the worktree. The status bar shows which one applies to the open file next to
the indentation, and turns amber with the reason when its last run failed.

| Formatter     | Files                                                                       | Used when                                                                                                                                                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier      | JS, TS, JSX, TSX, JSON, CSS, SCSS, Less, HTML, Vue, Markdown, YAML, GraphQL | A Prettier config file or a `"prettier"` key in `package.json` (a shareable config like `"@acme/prettier-config"` works), or `prettier` in the package's dependencies. Argus runs the `prettier` in the worktree's `node_modules`, nearest the file first, so monorepo packages get their own; `.prettierignore` is honoured |
| SwiftFormat   | Swift                                                                       | A `.swiftformat` file, with `swiftformat` installed (`brew install swiftformat`)                                                                                                                                                                                                                                             |
| swift-format  | Swift                                                                       | A `.swift-format` file; uses `swift-format` on your `PATH`, else the one in Xcode 16 and later                                                                                                                                                                                                                               |
| gofmt         | Go                                                                          | A `go.mod`, with `gofmt` on your `PATH`                                                                                                                                                                                                                                                                                      |
| Ruff or Black | Python                                                                      | `ruff.toml`, `.ruff.toml` or `[tool.ruff]` in `pyproject.toml` (Ruff); `[tool.black]` (Black)                                                                                                                                                                                                                                |

Anything else falls back to the file's language server. Argus never installs a
formatter, and organize imports or `eslint --fix` on save aren't supported.

## Turning servers off

Language servers can be switched off altogether, or per language, in the Mac
app's **Editor** settings. A language that's off never starts a server.
