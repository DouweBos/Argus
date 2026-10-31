import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@Suite("Session file paths")
struct SessionFilePathsTests {
  let files = ["src/a.ts", "pkg/src/a.ts", "README.md"]

  @Test func relativePathsAreNormalisedWithoutTheFileList() {
    #expect(SessionFilePaths.relative("./src/../src/a.ts", files: []) == "src/a.ts")
    #expect(SessionFilePaths.relative("../outside.ts", files: []) == nil)
    #expect(SessionFilePaths.needsFileList("src/a.ts") == false)
  }

  @Test func absolutePathsMatchTheLongestSessionFileBySuffix() {
    #expect(SessionFilePaths.needsFileList("/Users/me/wt/pkg/src/a.ts"))
    #expect(SessionFilePaths.relative("/Users/me/wt/pkg/src/a.ts", files: files) == "pkg/src/a.ts")
    #expect(SessionFilePaths.relative("~/wt/README.md", files: files) == "README.md")
    #expect(SessionFilePaths.relative("/etc/hosts", files: files) == nil)
  }

  @Test func splitsNameAndDirectory() {
    #expect(SessionFilePaths.fileName("pkg/src/a.ts") == "a.ts")
    #expect(SessionFilePaths.directory("pkg/src/a.ts") == "pkg/src")
    #expect(SessionFilePaths.directory("a.ts") == "")
  }
}

@MainActor
struct HostStoreFilesTests {
  @Test func readsAFileBySessionRelativePath() async throws {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("files.read", #"{"content":"hi","hash":"x","mtimeMs":1,"size":2,"eol":"lf"}"#)
    let store = HostStore()
    await store.attach(backend)

    let file = try await store.readFile(sessionId: "s1", path: "a.ts")
    #expect(file.content == "hi")
    #expect(
      backend.calls("files.read").first?.params
        == .object(["session_id": .string("s1"), "path": .string("a.ts")]))
  }

  @Test func streamsMatchesGroupedByFileThenFinishes() async throws {
    let backend = RecordingBackend(kind: .gateway)
    let store = HostStore()
    await store.attach(backend)
    let search = FileSearchStore(host: store, sessionId: "s1")
    var finished: (Int, Bool)?
    search.onFinished = { _, count, truncated in finished = (count, truncated) }
    backend.reply("files.search", #"{"search_id":"x"}"#)

    await search.run(FileSearchQuery(text: "foo", regex: true))
    #expect(search.phase == .running)
    let call = try #require(backend.calls("files.search").first)
    let id = try #require(Self.searchId(call))
    #expect(backend.subscriptions.first?.0 == "code-search:\(id)")

    try backend.emit("files.search", payload: Self.matches(id, ["a.ts", "b.ts", "a.ts"]))
    try backend.emit(
      "files.search",
      payload: #"{"kind":"done","searchId":"\#(id)","count":3,"truncated":false,"cancelled":false}"#)
    #expect(await eventually { search.phase == .done(count: 3, truncated: false) })
    #expect(search.groups.map(\.path) == ["a.ts", "b.ts"])
    #expect(search.groups.first?.matches.count == 2)
    #expect(finished?.0 == 3)
    #expect(await eventually { backend.subscriptions.last.map { $0 == ("code-search:\(id)", false) } == true })
  }

  @Test func aNewQueryCancelsTheLastAndIgnoresItsStragglers() async throws {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("files.search", #"{"search_id":"x"}"#)
    backend.reply("files.search_cancel", #"{"accepted":true}"#)
    let store = HostStore()
    await store.attach(backend)
    let search = FileSearchStore(host: store, sessionId: "s1")

    await search.run(FileSearchQuery(text: "one"))
    let first = try #require(backend.calls("files.search").first.flatMap(Self.searchId))
    await search.run(FileSearchQuery(text: "two"))
    #expect(backend.calls("files.search_cancel").count == 1)
    try backend.emit("files.search", payload: Self.matches(first, ["stale.ts"]))
    try await Task.sleep(for: .milliseconds(50))
    #expect(search.groups.isEmpty)
    #expect(search.phase == .running)
  }

  @Test func scheduleDebouncesToTheLastQuery() async throws {
    let backend = RecordingBackend(kind: .gateway)
    backend.reply("files.search", #"{"search_id":"x"}"#)
    let store = HostStore()
    await store.attach(backend)
    let search = FileSearchStore(host: store, sessionId: "s1")
    search.debounce = .milliseconds(20)

    search.schedule(FileSearchQuery(text: "f"))
    search.schedule(FileSearchQuery(text: "fo"))
    #expect(await eventually { !backend.calls("files.search").isEmpty })
    try await Task.sleep(for: .milliseconds(40))
    let calls = backend.calls("files.search")
    #expect(calls.count == 1)
    guard case .object(let params)? = calls.first?.params else { return }
    #expect(params["query"] == .string("fo"))
  }

  @Test func shownReferencesSurviveTheirOwnTitleBeingScheduled() async throws {
    let backend = RecordingBackend(kind: .gateway)
    let store = HostStore()
    await store.attach(backend)
    let search = FileSearchStore(host: store, sessionId: "s1")
    search.debounce = .milliseconds(1)
    let event = try JSONDecoder().decode(
      ArgusProtocol.CodeSearchEvent.self, from: Data(Self.matches("r", ["a.ts", "a.ts"]).utf8))
    let batch = try #require({ if case .matches(let b) = event { b } else { nil } }())

    search.show(batch.matches, title: "foo")
    search.schedule(FileSearchQuery(text: "foo"))
    try await Task.sleep(for: .milliseconds(30))
    #expect(backend.calls("files.search").isEmpty)
    #expect(search.phase == .done(count: 2, truncated: false))
    #expect(search.groups.map(\.path) == ["a.ts"])
  }

  nonisolated static func searchId(_ call: RecordingBackend.Call) -> String? {
    guard case .object(let params) = call.params, case .string(let id) = params["search_id"] else {
      return nil
    }
    return id
  }

  static func matches(_ id: String, _ paths: [String]) -> String {
    let items = paths.enumerated().map { index, path in
      #"{"relativePath":"\#(path)","line":\#(index + 1),"column":0,"length":3,"preview":"foo","previewOffset":0}"#
    }
    return #"{"kind":"matches","searchId":"\#(id)","matches":[\#(items.joined(separator: ","))]}"#
  }
}
