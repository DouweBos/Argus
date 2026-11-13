import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Usage model filter")
struct UsageModelFilterTests {
  private let haiku = ArgusProtocol.UsageModelRule(runner: nil, model: "claude-haiku-4-5")

  @Test("a rule already on a list isn't added twice; the other list still takes it")
  func addDeduplicates() throws {
    let once = try #require(ArgusProtocol.UsageModelFilter.empty.adding(haiku, to: .exclude))
    #expect(once.exclude.map(\.model) == ["claude-haiku-4-5"])
    #expect(once.adding(haiku, to: .exclude) == nil)
    let scoped = ArgusProtocol.UsageModelRule(runner: "codex", model: "claude-haiku-4-5")
    #expect(once.adding(scoped, to: .exclude)?.exclude.count == 2)
    #expect(once.adding(haiku, to: .include)?.include.count == 1)
  }

  @Test("nil removes a rule, a rule replaces it, an index out of range does nothing")
  func change() {
    let filter = ArgusProtocol.UsageModelFilter(include: [haiku], exclude: [])
    #expect(filter.changing(0, in: .include, to: nil).include.isEmpty)
    #expect(filter.changing(0, in: .include, to: .init(runner: "codex", model: "gpt-5.5")).include.first?.runner == "codex")
    #expect(filter.changing(3, in: .include, to: nil).include.count == 1)
  }

  @Test("an empty filter goes over the wire as null")
  func emptyIsNil() {
    #expect(ArgusProtocol.UsageModelFilter.empty.orNil == nil)
    #expect(ArgusProtocol.UsageModelFilter(include: [], exclude: [haiku]).orNil != nil)
  }

  @Test("an unset filter loads as empty")
  func loadsNullAsEmpty() async {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(.usageModelFilter, #"{"filter":null}"#)
    await store.attach(backend)

    await store.loadUsageModelFilter()

    #expect(store.usageModelFilter?.include.isEmpty == true)
    #expect(store.usageModelFilter?.exclude.isEmpty == true)
  }

  @Test("saving the last rule away sends null")
  func clearSendsNull() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(.usageSetModelFilter, #"{"filter":null}"#)
    await store.attach(backend)

    #expect(await store.saveUsageModelFilter(.empty) == nil)

    let params = try #require(backend.params(.usageSetModelFilter))
    #expect(params["filter"] is NSNull)
  }

  @Test("a refused save puts the previous filter back")
  func failureReverts() async {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(.usageModelFilter, #"{"filter":{"include":[],"exclude":[{"runner":null,"model":"claude-haiku-4-5"}]}}"#)
    backend.fail(.usageSetModelFilter)
    await store.attach(backend)
    await store.loadUsageModelFilter()

    #expect(await store.saveUsageModelFilter(.empty) != nil)
    #expect(store.usageModelFilter?.exclude.map(\.model) == ["claude-haiku-4-5"])
  }
}
