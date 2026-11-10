import Foundation

/// The git area's gallery data. The Mac renders a real repository built by
/// `script`; the phone gets the same repository as wire replies.
public enum GalleryGit {
  public static let rootSessionId = "gallery-git-root"
  public static let worktreeSessionId = "gallery-git-worktree"
  public static let repoRoot = "/Users/dev/Projects/luma"
  public static let branch = "feat/merge-strategy"

  /// Builds `<dir>/luma` (history, branches, tags, stashes) with a bare
  /// `origin` beside it and the session's worktree under `<dir>/luma-worktrees/`.
  public static let script = #"""
#!/bin/sh
# Builds the gallery's git repository: a project with history, branches, tags, stashes and a worktree.
set -e
ROOT="$1"
rm -rf "$ROOT"; mkdir -p "$ROOT"; cd "$ROOT"
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
NOW=$(date +%s)
c() { # c <hours ago> <author> <subject>
  T=$((NOW - $1 * 3600))
  GIT_AUTHOR_NAME="$2" GIT_AUTHOR_EMAIL="$(echo "$2" | tr 'A-Z ' 'a-z.')@example.com" GIT_AUTHOR_DATE="@$T +0000" \
  GIT_COMMITTER_NAME="$2" GIT_COMMITTER_EMAIL="$(echo "$2" | tr 'A-Z ' 'a-z.')@example.com" GIT_COMMITTER_DATE="@$T +0000" \
  git commit -q -m "$3"
}
s() { # s <minutes ago> <message>
  T=$((NOW - $1 * 60))
  GIT_AUTHOR_DATE="@$T +0000" GIT_COMMITTER_DATE="@$T +0000" git stash push -q -m "$2"
}
git init -q --bare origin.git
git init -q -b main luma; cd luma
git config user.name "Maya Chen"; git config user.email maya.chen@example.com
git remote add origin ../origin.git
mkdir -p src/session src/terminal src/git src/remote src/legacy docs
printf '# luma\n\nA web client for the luma media server.\n' > README.md
printf '{\n  "name": "luma",\n  "version": "0.70.0",\n  "type": "module"\n}\n' > package.json
git add -A; c 340 "Maya Chen" "chore: initial commit"
cat > src/session/worktree.ts <<'X'
import { gitAt } from "../git/run"

/** Worktrees live beside the project, never inside it. */
export function worktreePath(root: string, branch: string) {
  return `${root}-worktrees/${branch}`
}

export async function addWorktree(root: string, branch: string) {
  const git = gitAt(root)
  await git.run(["worktree", "add", worktreePath(root, branch), "-b", branch])
}
X
printf 'export function bridge() {\n  return window.electron\n}\n' > src/legacy/bridge.ts
git add -A; c 310 "Jonas Weber" "feat(session): create worktrees outside the project directory"
cat > src/terminal/pty.ts <<'X'
import { spawn } from "node-pty"

export function openShell(cwd: string) {
  return spawn(process.env.SHELL ?? "zsh", [], { cwd, cols: 80, rows: 24 })
}
X
git add -A; c 260 "Jonas Weber" "feat(terminal): spawn shells through node-pty"
cat > src/session/merge.ts <<'X'
import { gitAt } from "../git/run"
import { hooks } from "./hooks"
import { log } from "../log"

/**
 * Merges a session's branch back into the project's base branch.
 * Hooks run before the merge so a failing check stops it.
 */
export async function merge(root: string, branch: string) {
  const git = gitAt(root)
  const base = await git.mergeBase(root)

  for (const hook of hooks) await hook.before(branch)

  // Nothing to merge is not an error.
  if (await git.isAncestor(branch, base)) return
  return git.merge(branch, { base })
}
X
git add -A; c 200 "Maya Chen" "feat(session): merge a session back into its base branch"
git tag v0.71.0
printf '# Worktrees\n\nEvery session gets a worktree beside the project.\n' > docs/worktrees.md
git add -A; c 150 "Priya Raman" "docs: explain how worktrees are laid out"
printf 'export async function status(root: string) {\n  return gitAt(root).run(["status", "--porcelain=v2", "--branch"])\n}\n' > src/git/status.ts
git add -A; c 96 "Maya Chen" "perf(git): read status once per refresh"
git tag -a v0.72.0 -m "luma 0.72.0"
git push -q origin main --tags 2>/dev/null
git checkout -q -b release/0.72
sed -i '' 's/0.70.0/0.72.0/' package.json; git add -A; c 90 "Maya Chen" "chore(release): 0.72.0"
git push -q origin release/0.72; git checkout -q main; git branch -q -D release/0.72
git checkout -q -b dependabot/npm_and_yarn/vite-7.1.4
printf '{\n  "name": "luma",\n  "version": "0.70.0",\n  "type": "module",\n  "devDependencies": { "vite": "7.1.4" }\n}\n' > package.json
git add -A; c 30 "dependabot[bot]" "build(deps-dev): bump vite from 7.1.2 to 7.1.4"
git push -q origin dependabot/npm_and_yarn/vite-7.1.4; git checkout -q main; git branch -q -D dependabot/npm_and_yarn/vite-7.1.4
# Local branches off the published main.
git checkout -q -b feat/merge-strategy
printf 'export type MergeStrategy = "merge" | "squash" | "rebase"\n' > src/session/strategy.ts
git add -A; c 50 "Argus Agent" "feat(session): pick a merge strategy per project"
printf 'import { test } from "vitest"\n\ntest("squash merges keep one commit", () => {})\n' > src/session/merge.test.ts
git add -A; c 48 "Argus Agent" "test(session): cover squash merges"
git push -q -u origin feat/merge-strategy
printf 'export type MergeStrategy = "merge" | "squash" | "rebase"\n\nexport const defaultStrategy: MergeStrategy = "squash"\n' > src/session/strategy.ts
git add -A; c 20 "Argus Agent" "refactor(session): name the default strategy"
git checkout -q main
git checkout -q -b fix/terminal-resize-flicker
sed -i '' 's/rows: 24 })/rows: 24, handleFlowControl: true })/' src/terminal/pty.ts
git add -A; c 12 "Jonas Weber" "fix(terminal): debounce resize events while the window drags"
git checkout -q main
git checkout -q -b argus/move-the-diff-parser-into-its-own-module-with-tests-and-docs
printf 'export function parse(patch: string) {\n  return patch.split("\\ndiff --git ")\n}\n' > src/git/diff.ts
git add -A; c 6 "Argus Agent" "refactor(git): move the diff parser into its own module"
git checkout -q main
git checkout -q -b chore/node-24
printf '24\n' > .nvmrc; git add -A; c 70 "Priya Raman" "chore: build with node 24"
git push -q -u origin chore/node-24
git reset -q --hard HEAD~1
printf '24.11\n' > .nvmrc; git add -A; c 40 "Priya Raman" "chore: pin node 24.11"
git checkout -q main
git config branch.chore/node-24.remote origin; git config branch.chore/node-24.merge refs/heads/chore/node-24
printf 'export async function pair(code: string) {\n  return gateway.request("pair", { code })\n}\n' > src/remote/pair.ts
git add -A; c 3 "Maya Chen" "feat(remote): pair a phone over the gateway"
git tag v0.72.1
# Stashes, newest last.
printf '\nexport const debugGateway = true\n' >> src/remote/pair.ts; s 150 "debug logging for the gateway"
git checkout -q feat/merge-strategy
printf '\n// TODO: picker in project settings\n' >> src/session/strategy.ts; s 120 "half-done strategy picker"
git checkout -q main
sed -i '' 's/--branch"/--branch", "--ahead-behind"/' src/git/status.ts; s 60 "try a shorter fetch interval"
git fetch -q origin
# The session's worktree, with work in progress.
git worktree add -q ../luma-worktrees/feat/merge-strategy feat/merge-strategy
cd ../luma-worktrees/feat/merge-strategy
cat > src/session/merge.ts <<'X'
import { gitAt } from "../git/run"
import { hooks } from "./hooks"
import { log } from "../log"
import { settings } from "../settings"

/**
 * Merges a session's branch back into the project's base branch.
 * Hooks run before the merge so a failing check stops it.
 */
export async function merge(root: string, branch: string) {
  const git = gitAt(root)
  const strategy = await settings.mergeStrategy(root)

  for (const hook of hooks) await hook.before(branch)
  log.info("merging", { strategy })

  // Nothing to merge is not an error.
  if (!branch) {
    throw new Error("No branch")
  }
  return git.merge(branch, { strategy })
}
X
printf 'import { describe, expect, it } from "vitest"\nimport { defaultStrategy } from "./strategy"\n\ndescribe("strategy", () => {\n  it("squashes by default", () => {\n    expect(defaultStrategy).toBe("squash")\n  })\n})\n' > src/session/strategy.test.ts
git add src/session/strategy.test.ts
git rm -q src/legacy/bridge.ts
printf '# luma\n\nA web client for the luma media server.\n\nRun `pnpm dev` and open http://localhost:5173.\n' > README.md
printf 'scratch\n' > notes.txt
"""#

  /// `git diff HEAD` in the worktree.
  public static let workingDiff = contextLines(
    #"""
diff --git a/README.md b/README.md
index 7eb25f8..4cfb63e 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,5 @@
 # luma

 A web client for the luma media server.
+
+Run `pnpm dev` and open http://localhost:5173.
diff --git a/src/legacy/bridge.ts b/src/legacy/bridge.ts
deleted file mode 100644
index 6cc8952..0000000
--- a/src/legacy/bridge.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function bridge() {
-  return window.electron
-}
diff --git a/src/session/merge.ts b/src/session/merge.ts
index b65c6f5..2d7b2b9 100644
--- a/src/session/merge.ts
+++ b/src/session/merge.ts
@@ -1,6 +1,7 @@
 import { gitAt } from "../git/run"
 import { hooks } from "./hooks"
 import { log } from "../log"
+import { settings } from "../settings"

 /**
  * Merges a session's branch back into the project's base branch.
@@ -8,11 +9,14 @@ import { log } from "../log"
  */
 export async function merge(root: string, branch: string) {
   const git = gitAt(root)
-  const base = await git.mergeBase(root)
+  const strategy = await settings.mergeStrategy(root)

   for (const hook of hooks) await hook.before(branch)
+  log.info("merging", { strategy })

   // Nothing to merge is not an error.
-  if (await git.isAncestor(branch, base)) return
-  return git.merge(branch, { base })
+  if (!branch) {
+    throw new Error("No branch")
+  }
+  return git.merge(branch, { strategy })
 }
diff --git a/src/session/strategy.test.ts b/src/session/strategy.test.ts
new file mode 100644
index 0000000..89730e6
--- /dev/null
+++ b/src/session/strategy.test.ts
@@ -0,0 +1,8 @@
+import { describe, expect, it } from "vitest"
+import { defaultStrategy } from "./strategy"
+
+describe("strategy", () => {
+  it("squashes by default", () => {
+    expect(defaultStrategy).toBe("squash")
+  })
+})
"""#)

  /// `feat(session): merge a session back into its base branch`.
  public static let commitDiff = contextLines(
    #"""
diff --git a/src/session/merge.ts b/src/session/merge.ts
new file mode 100644
index 0000000..b65c6f5
--- /dev/null
+++ b/src/session/merge.ts
@@ -0,0 +1,18 @@
+import { gitAt } from "../git/run"
+import { hooks } from "./hooks"
+import { log } from "../log"
+
+/**
+ * Merges a session's branch back into the project's base branch.
+ * Hooks run before the merge so a failing check stops it.
+ */
+export async function merge(root: string, branch: string) {
+  const git = gitAt(root)
+  const base = await git.mergeBase(root)
+
+  for (const hook of hooks) await hook.before(branch)
+
+  // Nothing to merge is not an error.
+  if (await git.isAncestor(branch, base)) return
+  return git.merge(branch, { base })
+}
"""#)

  /// Blank context lines lose their leading space in source; diffs need it back.
  private static func contextLines(_ diff: String) -> String {
    diff.split(separator: "\n", omittingEmptySubsequences: false).map { $0.isEmpty ? " " : String($0) }
      .joined(separator: "\n")
  }
}
