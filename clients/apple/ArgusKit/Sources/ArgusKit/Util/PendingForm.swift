import Foundation

/// Which inline form a tool call awaiting a decision gets.
///
/// The form owns the call's input — the question form already shows the
/// questions, plan approval already shows the plan — so the card above it must
/// not print the input a second time.
public enum PendingForm: Sendable {
  case buttons
  case plan(String)
  case question([Questions.Question])

  public static func of(name: String, input: [String: JSONValue]) -> PendingForm {
    if name == "AskUserQuestion", let questions = Questions.parse(input) {
      return .question(questions)
    }
    if name == "ExitPlanMode", let plan = input["plan"]?.stringValue {
      return .plan(plan)
    }
    return .buttons
  }

  /// True when the form renders the call's input itself.
  public var ownsInput: Bool {
    if case .buttons = self { return false }
    return true
  }
}
