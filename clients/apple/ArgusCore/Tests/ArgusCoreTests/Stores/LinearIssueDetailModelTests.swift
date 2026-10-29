import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Linear issue detail")
struct LinearIssueDetailModelTests {
  /// The issue's fields without the closing brace, so a detail can extend it.
  private static func issue(
    state: String = #"{"id":"s1","name":"Todo","type":"unstarted","position":1}"#, priority: Int = 3
  ) -> String {
    #"""
    {"id":"i1","identifier":"ENG-1","title":"Fix login","description":"","url":"u","branchName":"eng-1",
     "state":\#(state),"priority":\#(priority),"estimate":null,"teamId":"t1","teamKey":"ENG",
     "teamName":"Engineering","assignee":null,"assigneeAvatarUrl":null,"labels":[],"project":null,
     "cycle":null,"parent":null,"pullRequestCount":0,"createdAt":0,"updatedAt":0
    """#
  }

  private static let started = #"{"id":"s2","name":"In Progress","type":"started","position":2}"#

  private static func detail() -> String {
    #"{"issue":\#(issue()),"comments":[],"attachments":[],"children":[]},"states":[\#(started),{"id":"s1","name":"Todo","type":"unstarted","position":1}]}"#
  }

  private func model() async -> (LinearIssueDetailModel, RecordingBackend, HostStore) {
    let store = HostStore()
    let backend = RecordingBackend()
    await store.attach(backend)
    backend.reply("linear.issue", Self.detail())
    // The model holds its store unowned, as the app does.
    return (LinearIssueDetailModel(ref: "ENG-1", host: store), backend, store)
  }

  @Test("loads the issue with its workflow in order")
  func loads() async {
    let (model, _, store) = await model()
    await model.load()

    #expect(model.issue?.identifier == "ENG-1")
    #expect(model.stateOptions.map(\.name) == ["Todo", "In Progress"])
    #expect(model.loadError == nil)
    withExtendedLifetime(store) {}
  }

  @Test("moving an issue sends the state and passes the result on")
  func movesState() async throws {
    let store = HostStore()
    let backend = RecordingBackend()
    await store.attach(backend)
    backend.reply("linear.issue", Self.detail())
    backend.reply("linear.update_issue", #"{"issue":\#(Self.issue(state: Self.started))}}"#)
    var changed: [String] = []
    let model = LinearIssueDetailModel(ref: "ENG-1", host: store) { changed.append($0.state.name) }
    await model.load()

    await model.setState("s2")

    #expect(backend.calls("linear.update_issue").first?.params == .object(["issue_id": .string("i1"), "state_id": .string("s2")]))
    #expect(model.issue?.state.name == "In Progress")
    #expect(changed == ["In Progress"])
  }

  @Test("a failed change puts the issue back and says why")
  func revertsOnFailure() async {
    let (model, backend, store) = await model()
    await model.load()
    backend.fail("linear.update_issue")

    await model.setPriority(1)

    #expect(model.issue?.priority == 3)
    #expect(model.actionError != nil)
    withExtendedLifetime(store) {}
  }

  @Test("an empty comment is never sent")
  func skipsEmptyComment() async {
    let (model, backend, store) = await model()
    await model.load()

    backend.reply("linear.comment", #"{"accepted":true}"#)
    #expect(await model.comment("   ") == false)
    #expect(backend.calls("linear.comment").isEmpty)
    #expect(await model.comment(" On it ") == true)
    #expect(backend.calls("linear.comment").first?.params == .object(["issue_id": .string("i1"), "body": .string("On it")]))
    withExtendedLifetime(store) {}
  }

  @Test("a reply goes to its thread")
  func repliesInThread() async {
    let (model, backend, store) = await model()
    await model.load()

    backend.reply("linear.comment", #"{"accepted":true}"#)
    #expect(await model.comment("Agreed", parentId: "c1") == true)
    #expect(
      backend.calls("linear.comment").first?.params
        == .object(["issue_id": .string("i1"), "body": .string("Agreed"), "parent_id": .string("c1")]))
    withExtendedLifetime(store) {}
  }
}
