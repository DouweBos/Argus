import Foundation
import Synchronization
import Testing

@testable import ArgusCore

// Replays each fixture generated from the renderer's conversationStore and the
// host's `agents.transcript` (clients/argus-ios/Tools/gen-conversation-fixtures.ts)
// and asserts the Swift port produces the same JSON at every step.

private let fixtureNames = [
  "plain-text-turn", "tool-results", "parallel-tools", "subagent", "todos-tasks",
  "permissions", "system-result", "resume", "user-images-injected", "quirks",
]

private func loadFixture(_ name: String) throws -> JSONValue {
  let url = try #require(
    Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures/conversation"))
  return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
}

private func decode<T: Decodable>(_ value: JSONValue?) throws -> T {
  try JSONDecoder().decode(T.self, from: JSONEncoder().encode(try #require(value)))
}

private func asJSON(_ value: some Encodable) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
}

/// Mirrors the generator's stubs: `uuid-1`, `uuid-2`… and a clock that
/// advances a second per read.
private func deterministicEnvironment(clockStart: Double) -> ConversationEnvironment {
  let ids = Mutex(0)
  let ticks = Mutex(0)
  return ConversationEnvironment(
    now: { clockStart + 1000 * Double(ticks.withLock { t in defer { t += 1 }; return t }) },
    makeId: { "uuid-\(ids.withLock { i in i += 1; return i })" })
}

/// Applies one recorded op; returns `setPermissionPending`'s result for those.
private func apply(_ op: JSONValue, to reducer: inout ConversationReducer) throws -> Bool? {
  switch op["op"]?.stringValue {
  case "event":
    reducer.appendEvent(try #require(op["event"]))
  case "userMessage":
    let images: [ConversationImage]? = try op["images"].map { try decode($0) }
    reducer.addUserMessage(
      try #require(op["text"]?.stringValue), images: images,
      checkpointId: op["checkpointId"]?.stringValue, author: op["author"]?.stringValue)
  case "systemMessage":
    reducer.appendSystemMessage(try decode(op["message"]))
  case "injectedPrompt":
    reducer.appendInjectedPrompt(try decode(op["message"]))
  case "loadSaved":
    reducer.loadSavedMessages(
      try decode(op["messages"]), model: op["model"]?.stringValue,
      sessionId: op["sessionId"]?.stringValue, resuming: op["resuming"]?.boolValue,
      title: op["title"]?.stringValue)
  case "setModel":
    reducer.setModel(try #require(op["model"]?.stringValue))
  case "setCapabilities":
    reducer.setCapabilities(try #require(op["capabilities"]))
  case "permissionPending":
    return reducer.setPermissionPending(
      toolUseId: try #require(op["request"]?["tool_use_id"]?.stringValue))
  case "clearPermission":
    reducer.clearPermission(toolUseId: try #require(op["toolUseId"]?.stringValue))
  case "cancelPermission":
    reducer.cancelPermission(toolUseId: try #require(op["toolUseId"]?.stringValue))
  case "setTitle":
    reducer.setTitle(try #require(op["title"]?.stringValue))
  case "clearTasks":
    reducer.clearTasks()
  case "clearTodos":
    reducer.clearTodos()
  case "migrate":
    reducer.markResuming()
  case let other:
    Issue.record("unknown op \(String(describing: other))")
  }
  return nil
}

/// Path of the first difference, so a failure names the field.
private func firstDifference(_ a: JSONValue, _ b: JSONValue, path: String = "$") -> String? {
  switch (a, b) {
  case (.object(let x), .object(let y)):
    for key in Set(x.keys).union(y.keys).sorted() {
      guard let xv = x[key], let yv = y[key] else {
        return "\(path).\(key): \(x[key].map { "\($0)" } ?? "absent") vs \(y[key].map { "\($0)" } ?? "absent")"
      }
      if let d = firstDifference(xv, yv, path: "\(path).\(key)") { return d }
    }
    return nil
  case (.array(let x), .array(let y)):
    if x.count != y.count { return "\(path): \(x.count) vs \(y.count) elements" }
    for (i, pair) in zip(x, y).enumerated() {
      if let d = firstDifference(pair.0, pair.1, path: "\(path)[\(i)]") { return d }
    }
    return nil
  default:
    return a == b ? nil : "\(path): \(a) vs \(b)"
  }
}

@Suite struct ConversationFixtureTests {
  @Test(arguments: fixtureNames)
  func snapshotsMatchRenderer(name: String) throws {
    let fixture = try loadFixture(name)
    let ops = try #require(fixture["ops"]?.arrayValue)
    let steps = try #require(fixture["steps"]?.arrayValue)
    let clockStart = try #require(fixture["clockStart"]?.numberValue)
    var reducer = ConversationReducer(environment: deterministicEnvironment(clockStart: clockStart))

    for (i, (op, step)) in zip(ops, steps).enumerated() {
      let found = try apply(op, to: &reducer)
      let actual = try asJSON(reducer.conversation)
      let expected = try #require(step["snapshot"])
      let label = "\(name) step \(i) (\(op["op"]?.stringValue ?? "?"))"
      #expect(firstDifference(actual, expected) == nil, "\(label): \(firstDifference(actual, expected) ?? "")")
      #expect(found == step["found"]?.boolValue, "\(label): permission found")
    }

    // The published snapshot round-trips through the Codable model unchanged.
    let snapshot = try JSONDecoder().decode(AgentConversation?.self, from: reducer.snapshotJSON())
    #expect(snapshot == reducer.conversation)
  }

  @Test(arguments: fixtureNames)
  func transcriptPagesMatchHost(name: String) throws {
    let fixture = try loadFixture(name)
    let final = try #require(fixture["steps"]?.arrayValue?.last?["snapshot"])
    // Built from the renderer's own snapshot, so this checks the host port alone.
    let conv: AgentConversation = try decode(final)

    for page in try #require(fixture["transcripts"]?.arrayValue) {
      let params = page["params"]
      let after = params?["after"]?.intValue
      let before = params?["before"]?.intValue
      let limit = params?["limit"]?.intValue
      let expected = try #require(page["result"])
      let actual = RemoteTranscriptBuilder.transcriptJSON(conv, after: after, before: before, limit: limit)
      #expect(firstDifference(actual, expected) == nil, "\(name) \(String(describing: params)): \(firstDifference(actual, expected) ?? "")")

      let typed = try RemoteTranscriptBuilder.transcript(conv, after: after, before: before, limit: limit)
      let hostTyped: RemoteTranscript = try decode(expected)
      #expect(typed.messages == hostTyped.messages)
      #expect(typed.tasks == hostTyped.tasks)
      #expect(typed.todos == hostTyped.todos)
      #expect(typed.total == hostTyped.total)
    }
  }

  @Test func imagesResolveFromMintedIds() throws {
    let fixture = try loadFixture("tool-results")
    let conv: AgentConversation = try decode(fixture["steps"]?.arrayValue?.last?["snapshot"])
    let shot = try #require(conv.messages.first { $0.toolCalls.contains { $0.id == "tu_shot" } })
    let image = RemoteTranscriptBuilder.image(
      in: conv, id: RemoteTranscriptBuilder.imageId(messageId: shot.id, slot: "tu_shot", blockIndex: 0))
    #expect(image?.mediaType == "image/png")
    #expect(image?.data.isEmpty == false)

    let attachments = try loadFixture("user-images-injected")
    let withImages: AgentConversation = try decode(attachments["steps"]?.arrayValue?.last?["snapshot"])
    let sent = try #require(withImages.messages.first { $0.checkpointId == "cp-42" })
    let second = RemoteTranscriptBuilder.image(
      in: withImages, id: RemoteTranscriptBuilder.imageId(messageId: sent.id, slot: "msg", blockIndex: 1))
    #expect(second?.mediaType == "image/jpeg")
    #expect(RemoteTranscriptBuilder.image(in: withImages, id: "nope") == nil)
  }

  @Test func rawPayloadStringsFeedTheReducer() throws {
    var reducer = ConversationReducer(environment: deterministicEnvironment(clockStart: 0))
    let malformed = reducer.appendEvent(json: "not json")
    #expect(!malformed)
    #expect(reducer.conversation == nil)
    let parsed = reducer.appendEvent(
      json: #"{"type":"assistant","message":{"model":"m","content":[{"type":"text","text":"Hi"}]}}"#)
    #expect(parsed)
    let messages = try #require(try reducer.conversation?.remoteMessages())
    #expect(messages.map(\.textBlocks) == [["Hi"]])
    #expect(messages.first?.id == "uuid-1")
  }
}
