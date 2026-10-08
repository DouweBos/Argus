import Foundation
import Testing

@testable import ArgusCore

@Suite("Fuzzy file matcher")
struct FuzzyFileMatcherTests {
  let paths = [
    "packages/host/src/services/session/watcher.ts",
    "clients/apple/ArgusCore/Sources/ArgusCore/Code/FuzzyFileMatcher.swift",
    "clients/apple/ArgusUI/Sources/ArgusUI/Views/CodeView.swift",
    "app/components/agent/AgentView.tsx",
    "docs/routing.md",
    "README.md",
    "fizz/zoom/m.swift",
  ]

  @Test("the file name beats letters scattered over directories")
  func basenameFirst() {
    let matcher = FuzzyFileMatcher(paths: paths)
    #expect(matcher.search("fzm").first?.path == paths[1])
    #expect(matcher.search("codeview").first?.path == paths[2])
    #expect(matcher.search("readme").first?.path == "README.md")
  }

  @Test("word boundaries and runs beat scattered letters")
  func boundaries() {
    let matcher = FuzzyFileMatcher(paths: ["src/xaxgxexnxt.ts", "src/AgentView.tsx", "src/agent.ts"])
    let ranked = matcher.search("agent").map(\.path)
    #expect(ranked.last == "src/xaxgxexnxt.ts")
    #expect(ranked.first == "src/agent.ts")
  }

  @Test("non-matches are dropped, matching is case-insensitive")
  func filtering() {
    let matcher = FuzzyFileMatcher(paths: paths)
    #expect(matcher.search("zzzq").isEmpty)
    #expect(matcher.search("WATCHER").map(\.path) == [paths[0]])
    #expect(matcher.search("agent view").first?.path == paths[3])
  }

  @Test("indices point at the matched characters")
  func indices() throws {
    let match = try #require(FuzzyFileMatcher.match("cv", path: "Views/CodeView.swift"))
    let units = Array("Views/CodeView.swift".utf16)
    #expect(match.indices.map { Character(UnicodeScalar(units[$0])!) } == ["C", "V"])
    #expect(match.indices == [6, 10])
  }

  @Test("changed files rank first, and lead an empty query")
  func boost() {
    let matcher = FuzzyFileMatcher(paths: paths)
    let boosted: Set = ["docs/routing.md"]
    let results = matcher.search("md", boost: boosted)
    #expect(results.first?.path == "docs/routing.md")
    #expect(results.first?.isBoosted == true)
    let empty = matcher.search("", boost: boosted, limit: 3)
    #expect(empty.map(\.path) == ["docs/routing.md", paths[0], paths[1]])
  }

  @Test("200k paths search fast")
  func benchmark() {
    var paths: [String] = []
    paths.reserveCapacity(200_000)
    let dirs = ["packages/host/src", "clients/apple/ArgusUI/Sources", "app/components/agent", "node_modules/lodash/fp"]
    for index in 0..<200_000 {
      paths.append("\(dirs[index % dirs.count])/module\(index / 7)/File\(index)View.swift")
    }
    let clock = ContinuousClock()
    var matcher: FuzzyFileMatcher!
    let build = clock.measure { matcher = FuzzyFileMatcher(paths: paths) }
    var results: [FuzzyFileMatcher.Match] = []
    let narrow = clock.measure { results = matcher.search("file1999view") }
    #expect(!results.isEmpty)
    let broad = clock.measure { results = matcher.search("fv") }
    #expect(results.count == 50)
    print("[perf] fuzzy 200k paths: index \(build), narrow query \(narrow), broad query \(broad)")
    #expect(narrow < .seconds(2))
    #expect(broad < .seconds(2))
  }
}
