import ArgusKit
import Foundation

/// A question asked of an agent on a read-only fork of its context, and its answer.
public struct SideQuestion: Identifiable, Sendable, Equatable {
  public let id: String
  public let question: String
  public internal(set) var answer: String?
  public internal(set) var error: String?
  /// Promoted into the agent's own conversation.
  public internal(set) var sent = false

  public var isPending: Bool { answer == nil && error == nil }
}

/// Side questions: answered off a throwaway fork, so the agent's turn and
/// transcript stay untouched until someone sends an answer to it.
extension HostStore {
  public func askSide(agentId: String, question: String) async {
    let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    let id = UUID().uuidString
    sideQuestionsByAgent[agentId, default: []].append(SideQuestion(id: id, question: text))
    do {
      guard let backend else { throw Transport.TransportError.notReady }
      let result = try await backend.request(
        .agentsAskSide,
        ArgusProtocol.MethodsTypes.AgentsAskSideParams(agentId: agentId, question: text),
        as: ArgusProtocol.MethodsTypes.AgentsAskSideResult.self)
      updateSide(agentId: agentId, id: id) { $0.answer = result.answer }
    } catch {
      updateSide(agentId: agentId, id: id) { $0.error = Self.describe(error) }
    }
  }

  /// Send an answered side question into the agent's conversation — queued behind a running turn.
  public func sendSideToAgent(agentId: String, id: String) async {
    guard let side = sideQuestionsByAgent[agentId]?.first(where: { $0.id == id }),
      let answer = side.answer, !side.sent
    else { return }
    updateSide(agentId: agentId, id: id) { $0.sent = true }
    await sendMessage(agentId: agentId, message: Self.sideMessage(question: side.question, answer: answer))
  }

  public func clearSideQuestions(agentId: String) {
    sideQuestionsByAgent[agentId] = nil
  }

  public nonisolated static func sideMessage(question: String, answer: String) -> String {
    "I asked a side question while you were working.\n\nQuestion: \(question)\n\nAnswer: \(answer)"
  }

  private func updateSide(agentId: String, id: String, _ change: (inout SideQuestion) -> Void) {
    guard let index = sideQuestionsByAgent[agentId]?.firstIndex(where: { $0.id == id }) else { return }
    change(&sideQuestionsByAgent[agentId]![index])
  }
}
