import ArgusCore
import ArgusKit
import Foundation
import Testing

@MainActor
@Suite("Side questions")
struct SideQuestionsTests {
  @Test("an answer lands beside the chat, not in it")
  func answerStaysOnTheSide() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(.agentsAskSide, #"{"answer":"In foo.ts."}"#)
    await store.attach(backend)

    await store.askSide(agentId: "a-1", question: "  where is it? ")

    let params = try #require(backend.params(.agentsAskSide))
    #expect(params["agent_id"] as? String == "a-1")
    #expect(params["question"] as? String == "where is it?")
    let side = try #require(store.sideQuestionsByAgent["a-1"]?.first)
    #expect(side.answer == "In foo.ts.")
    #expect(!side.isPending)
    #expect(backend.params(.agentsSend) == nil)
    #expect(store.messagesByAgent["a-1"] == nil)
  }

  @Test("a refused question keeps its error")
  func failureIsKept() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.fail(.agentsAskSide)
    await store.attach(backend)

    await store.askSide(agentId: "a-1", question: "why?")

    let side = try #require(store.sideQuestionsByAgent["a-1"]?.first)
    #expect(side.answer == nil)
    #expect(side.error != nil)
  }

  @Test("sending an answer posts it to the agent once")
  func sendToAgent() async throws {
    let store = HostStore()
    let backend = FakeBackend()
    backend.reply(.agentsAskSide, #"{"answer":"Yes."}"#)
    backend.reply(.agentsSend, #"{"queued":true}"#)
    await store.attach(backend)
    await store.askSide(agentId: "a-1", question: "Is it done?")
    let id = try #require(store.sideQuestionsByAgent["a-1"]?.first?.id)

    await store.sendSideToAgent(agentId: "a-1", id: id)

    let params = try #require(backend.params(.agentsSend))
    #expect(params["message"] as? String == HostStore.sideMessage(question: "Is it done?", answer: "Yes."))
    #expect(store.sideQuestionsByAgent["a-1"]?.first?.sent == true)

    store.clearSideQuestions(agentId: "a-1")
    #expect(store.sideQuestionsByAgent["a-1"] == nil)
  }
}
