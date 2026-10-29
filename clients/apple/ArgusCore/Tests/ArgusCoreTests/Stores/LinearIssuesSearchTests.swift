import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Linear issue search")
struct LinearIssuesSearchTests {
  private static func issue(_ id: String) -> String {
    #"""
    {"id":"\#(id)","identifier":"\#(id)","title":"t","description":"","url":"u","branchName":"b",
     "state":{"id":"s1","name":"Backlog","type":"backlog","position":0},"priority":0,"estimate":null,
     "teamId":"t1","teamKey":"RTN","teamName":"Returns","assignee":null,"assigneeAvatarUrl":null,"labels":[],
     "project":null,"cycle":null,"parent":null,"pullRequestCount":0,"createdAt":0,"updatedAt":0}
    """#
  }

  private func connected() async -> (HostStore, RecordingBackend) {
    let store = HostStore()
    let backend = RecordingBackend()
    await store.attach(backend)
    backend.reply(
      "integrations.list",
      #"{"integrations":[{"id":"linear","connected":true,"needsReauth":false,"oauthAvailable":false}]}"#)
    await store.loadIntegrations()
    return (store, backend)
  }

  @Test("a term is trimmed, and blank is no search")
  func term() {
    #expect(LinearIssuesModel.term("  RTN-9181 ") == "RTN-9181")
    #expect(LinearIssuesModel.term("   ") == nil)
    #expect(LinearIssuesModel.term(nil) == nil)
  }

  @Test("a search asks the whole workspace, without a scope, and reports once")
  func searches() async {
    let (store, backend) = await connected()
    backend.reply("linear.issues", #"{"issues":[\#(Self.issue("RTN-9181")),\#(Self.issue("RTN-1"))]}"#)
    let model = LinearIssuesModel(host: store, defaults: nil)
    var reported: [Int] = []
    model.onSearched = { reported.append($0) }

    model.query = "rtn"
    await model.refresh()
    await model.refresh()

    #expect(model.issues?.map(\.identifier) == ["RTN-9181", "RTN-1"])
    #expect(
      backend.calls("linear.issues").last?.params
        == .object(["query": .string("rtn"), "limit": .number(Double(LinearIssuesModel.searchLimit))]))
    #expect(reported == [2])

    model.query = "other"
    #expect(model.issues == nil)
    await model.refresh()
    #expect(reported == [2, 2])
  }

  @Test("listing a scope reports nothing, and search keeps its own filters")
  func scopeIsSeparate() async {
    let (store, backend) = await connected()
    backend.reply("linear.issues", #"{"issues":[\#(Self.issue("ENG-1"))]}"#)
    let model = LinearIssuesModel(host: store, defaults: nil)
    var reported: [Int] = []
    model.onSearched = { reported.append($0) }
    model.filters = [IssueFilters.currentCycle]

    await model.refresh()
    #expect(
      backend.calls("linear.issues").last?.params
        == .object(["scope": .string("assigned"), "limit": .number(100)]))
    #expect(reported.isEmpty)

    model.query = "x"
    #expect(model.filters.isEmpty)
    model.query = nil
    #expect(model.filters == [IssueFilters.currentCycle])
  }
}
