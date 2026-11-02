import type { FixtureResolver, FixtureScenario } from "../types";
import { AGENTS, BASE_CHANNELS, BASE_STORAGE, NOW } from "./aurora";

/**
 * A real unified diff — the viewer parses this the same way it parses git's
 * output, so the hunk headers and counts have to add up.
 */
const DIFF = `diff --git a/src/search/TrigramIndex.swift b/src/search/TrigramIndex.swift
new file mode 100644
index 0000000..b3f21ac
--- /dev/null
+++ b/src/search/TrigramIndex.swift
@@ -0,0 +1,24 @@
+import Foundation
+
+/// Trigram index over episode titles. Built once per library refresh and
+/// queried on the main actor, so every operation here is O(1) amortised.
+struct TrigramIndex {
+    private var postings: [Trigram: Set<EpisodeID>] = [:]
+
+    mutating func insert(_ title: String, id: EpisodeID) {
+        for trigram in Trigram.all(in: title) {
+            postings[trigram, default: []].insert(id)
+        }
+    }
+
+    func search(_ query: String) -> Set<EpisodeID> {
+        let trigrams = Trigram.all(in: query)
+        guard let first = trigrams.first else { return [] }
+
+        return trigrams.dropFirst().reduce(postings[first] ?? []) { acc, gram in
+            acc.intersection(postings[gram] ?? [])
+        }
+    }
+
+    var isEmpty: Bool { postings.isEmpty }
+}
diff --git a/src/search/SearchViewModel.swift b/src/search/SearchViewModel.swift
index 7a1c4de..29ef0b1 100644
--- a/src/search/SearchViewModel.swift
+++ b/src/search/SearchViewModel.swift
@@ -12,9 +12,9 @@ final class SearchViewModel: ObservableObject {
     @Published private(set) var results: [Episode] = []

-    private let index = LinearScanIndex()
+    private var index = TrigramIndex()

     func search(_ query: String) {
-        results = library.filter { $0.title.localizedCaseInsensitiveContains(query) }
+        results = library.filter { index.search(query).contains($0.id) }
     }
 }
@@ -34,6 +34,7 @@ final class SearchViewModel: ObservableObject {
     func refresh(_ library: [Episode]) {
         self.library = library
+        library.forEach { index.insert($0.title, id: $0.id) }
     }
 }
diff --git a/tests/TrigramIndexTests.swift b/tests/TrigramIndexTests.swift
new file mode 100644
index 0000000..5cd8e02
--- /dev/null
+++ b/tests/TrigramIndexTests.swift
@@ -0,0 +1,12 @@
+import XCTest
+@testable import Aurora
+
+final class TrigramIndexTests: XCTestCase {
+    func testMatchesPartialTitles() {
+        var index = TrigramIndex()
+        index.insert("The Silent Sea", id: .init(rawValue: 1))
+
+        XCTAssertEqual(index.search("ilent"), [.init(rawValue: 1)])
+    }
+}
`;

const STATUS = {
  ahead: 2,
  behind: 0,
  branch: "search-rewrite",
  conflictCount: 0,
  detached: false,
  dirtyCount: 3,
  inProgress: null,
  lastFetchAt: NOW - 11 * 60_000,
  stashCount: 0,
  upstream: null,
};

/** The diff viewer mid-review — "review like a human". */
export const review: FixtureScenario = {
  id: "review",
  route: "/sessions/ses_search/git",
  storage: BASE_STORAGE,
  events: AGENTS.map((a) => ({ channel: "agent:started", payload: a })),
  channels: {
    ...BASE_CHANNELS,
    list_agents: ((args) =>
      AGENTS.filter((a) => a.session_id === args.sessionId)) as FixtureResolver,
    git_status: STATUS,
    get_session_diff: DIFF,
    get_session_full_diff: DIFF,
    get_session_branch_diff: DIFF,
    get_session_staged_diff: "",
    get_session_untracked_diff: "",
  },
};
