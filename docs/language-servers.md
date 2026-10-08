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
  need a build server — see below. A package inside the app that lists only
  iOS-family platforms counts as part of the app.
- **A lone Swift file**, outside any package or project, runs in single-file
  mode. Several loose files in one folder don't: `sourcekit-lsp` can't see
  how they fit together and would report each other's types as missing. The
  status bar says **Swift: limited here**.

#### Swift in Xcode projects

On its own, `sourcekit-lsp` doesn't know an Xcode project's SDK, targets or
modules, so it reports errors like `No such module 'UIKit'` for code that
builds fine. Rather than show those, Argus doesn't start it for files in an
Xcode project, and the status bar says **Swift: needs a build server**.
Highlighting, folding and search keep working.

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

## Turning servers off

Language servers can be switched off altogether, or per language, in the Mac
app's **Editor** settings. A language that's off never starts a server.
