/**
 * Real git repositories behind the fixture's worktrees. The Mac app reads a
 * session's repository itself (Grove) rather than asking the host, so its Git
 * view and branch rows need something on disk: one small repo per worktree,
 * on its branch, and the search rewrite mid-change with the diff `review`
 * tells its story with.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { DIFF } from "../../app/lib/fixture/scenarios/review";

const run = promisify(execFile);
const HOURS = 60 * 60_000;

/** What `SearchViewModel.swift` reads before the rewrite and after it. */
const VIEW_MODEL_BEFORE = `import Combine
import Foundation

/// Drives the search field: publishes the episodes whose titles match the
/// query, for the results list.
@MainActor
final class SearchViewModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var results: [Episode] = []

    private var library: [Episode] = []
    private let index = LinearScanIndex()

    func search(_ query: String) {
        results = library.filter { $0.title.localizedCaseInsensitiveContains(query) }
    }

    func refresh(_ library: [Episode]) {
        self.library = library
    }
}
`;

const VIEW_MODEL_AFTER = VIEW_MODEL_BEFORE.replace(
  "    private let index = LinearScanIndex()",
  "    private var index = TrigramIndex()",
)
  .replace(
    "results = library.filter { $0.title.localizedCaseInsensitiveContains(query) }",
    "results = library.filter { index.search(query).contains($0.id) }",
  )
  .replace(
    "        self.library = library\n",
    "        self.library = library\n        library.forEach { index.insert($0.title, id: $0.id) }\n",
  );

/** The files the review diff adds whole, as its `+` lines spell them. */
function newFilesInDiff(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const section of DIFF.split(/^diff --git /m).slice(1)) {
    if (!section.includes("new file mode")) {
      continue;
    }
    const name = /^\+\+\+ b\/(.+)$/m.exec(section)?.[1];
    if (!name) {
      continue;
    }
    const body = section
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1));
    files[name] = `${body.join("\n")}\n`;
  }

  return files;
}

async function git(cwd: string, args: string[], hoursAgo = 0): Promise<void> {
  const date = new Date(Date.now() - hoursAgo * HOURS).toISOString();
  await run("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Aurora Dev",
      GIT_AUTHOR_EMAIL: "dev@aurora.example",
      GIT_COMMITTER_NAME: "Aurora Dev",
      GIT_COMMITTER_EMAIL: "dev@aurora.example",
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      // Never the developer's hooks, signing or templates.
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

function write(root: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  }
}

async function commit(
  root: string,
  message: string,
  hoursAgo: number,
): Promise<void> {
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-q", "--no-gpg-sign", "-m", message], hoursAgo);
}

/** A worktree on `branch`, off a `main` that already has the app's search. */
export async function materializeWorktree(
  root: string,
  branch: string,
): Promise<void> {
  fs.mkdirSync(root, { recursive: true });
  await git(root, ["init", "-q", "-b", "main"]);
  // The app commits as the repo says, not as whoever runs the script.
  await git(root, ["config", "user.name", "Aurora Dev"]);
  await git(root, ["config", "user.email", "dev@aurora.example"]);
  write(root, {
    "README.md": "# Aurora\n\nA podcast player for iOS and Android.\n",
    "src/search/SearchViewModel.swift": VIEW_MODEL_BEFORE,
  });
  await commit(root, "Search episodes by title", 30);
  await git(root, ["checkout", "-q", "-b", branch]);
  if (branch !== "search-rewrite") {
    return;
  }
  // Two commits ahead of main, then the change under review.
  write(root, {
    "src/search/Trigram.swift":
      "/// Three consecutive characters of a lower-cased title.\nstruct Trigram: Hashable {\n    let value: String\n}\n",
  });
  await commit(root, "Add a trigram type for the search index", 3);
  write(root, {
    "tests/SearchBenchmark.swift":
      "import XCTest\n\nfinal class SearchBenchmark: XCTestCase {\n    func testFiveThousandTitles() {}\n}\n",
  });
  await commit(root, "Benchmark search over 5k titles", 2);
  write(root, {
    ...newFilesInDiff(),
    "src/search/SearchViewModel.swift": VIEW_MODEL_AFTER,
  });
}
