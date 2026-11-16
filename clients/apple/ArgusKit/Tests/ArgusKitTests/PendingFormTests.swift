import Foundation
import Testing

@testable import ArgusKit

/// Which form a pending call gets decides whether the card above it may print
/// the input — get it wrong and the questions show up twice, once as raw JSON.
@Suite("Pending forms")
struct PendingFormTests {

  @Test("a question payload owns its input")
  func question() {
    let input: [String: JSONValue] = [
      "questions": .array([
        .object([
          "question": .string("Which database?"),
          "header": .string("Storage"),
          "options": .array([.object(["label": .string("Postgres")])]),
        ])
      ])
    ]

    guard case .question(let questions) = PendingForm.of(name: "AskUserQuestion", input: input)
    else {
      Issue.record("expected a question form")
      return
    }
    #expect(questions.count == 1)
    #expect(PendingForm.of(name: "AskUserQuestion", input: input).ownsInput)
  }

  @Test("a secret request gets the secure form, whatever the MCP prefix")
  func secret() {
    let input: [String: JSONValue] = [
      "label": .string("Expo token"), "reason": .string("Build"),
      "delivery": .string("env"), "run_command": .string("Dev"), "env_var": .string("EXPO_TOKEN"),
    ]
    guard case .secret(let request) = PendingForm.of(name: "mcp__argus__request_secret", input: input)
    else {
      Issue.record("expected a secret form")
      return
    }
    #expect(request.label == "Expo token")
    #expect(request.delivery == .env(runCommand: "Dev", variable: "EXPO_TOKEN"))
    #expect(PendingForm.of(name: "request_secret", input: ["label": .string("PIN")]).ownsInput)
    guard case .buttons = PendingForm.of(name: "mcp__argus__request_secret", input: [:]) else {
      Issue.record("a call with no label has nothing to show")
      return
    }
  }

  @Test("a plan owns its input")
  func plan() {
    let form = PendingForm.of(name: "ExitPlanMode", input: ["plan": .string("# Do the thing")])

    guard case .plan(let text) = form else {
      Issue.record("expected a plan form")
      return
    }
    #expect(text == "# Do the thing")
    #expect(form.ownsInput)
  }

  @Test("anything else falls back to allow/deny, which shows no input")
  func buttons() {
    let bash = PendingForm.of(name: "Bash", input: ["command": .string("ls")])
    #expect(!bash.ownsInput)

    // A malformed payload has nothing to render, so it must not claim the input.
    let empty = PendingForm.of(name: "AskUserQuestion", input: [:])
    #expect(!empty.ownsInput)
    let planless = PendingForm.of(name: "ExitPlanMode", input: [:])
    #expect(!planless.ownsInput)
  }
}
