import Foundation
import Testing
@testable import ArgusKit

/// The preamble is a live instruction to the agent and the thing the desktop
/// parses back into chips, so it has to match the TypeScript byte for byte.
@Suite("Linked-projects preamble")
struct LinkedProjectsTests {
  struct Fixture: Decodable {
    struct Parsed: Decodable {
      var paths: [String]
      var rest: String
    }
    var built: String
    var parsed: Parsed
  }

  private func fixture() throws -> Fixture {
    let url = Bundle.module.url(forResource: "linked-projects", withExtension: "json")!
    return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
  }

  @Test("builds the exact string the desktop builds")
  func buildsIdentically() throws {
    let f = try fixture()
    let built = LinkedProjects.buildPreamble(
      paths: ["~/Work/Argus", "~/Work/Peacock"], message: "please fix the build")
    #expect(built == f.built)
  }

  @Test("parses the desktop's own output")
  func parsesDesktopOutput() throws {
    let f = try fixture()
    let parsed = try #require(LinkedProjects.parsePreamble(f.built))
    #expect(parsed.paths == f.parsed.paths)
    #expect(parsed.rest == f.parsed.rest)
  }

  @Test("leaves an ordinary message alone")
  func passesThrough() {
    #expect(LinkedProjects.buildPreamble(paths: [], message: "hello") == "hello")
    #expect(LinkedProjects.parsePreamble("hello") == nil)
  }

  @Test("a truncated preamble is not treated as one")
  func truncated() {
    // No closing bracket means we can't tell where the paths end.
    let broken = LinkedProjects.head + "\n- ~/Work/Argus"
    #expect(LinkedProjects.parsePreamble(broken) == nil)
  }
}

/// The answer to an AskUserQuestion travels as a deny carrying this exact
/// text, so its shape is a contract with the desktop, not a display choice.
@Suite("Question answers")
struct QuestionAnswerTests {
  private let questions = [
    Questions.Question(
      question: "Which database?", header: "Database",
      options: [.init(label: "Postgres"), .init(label: "SQLite")], multiSelect: false),
    Questions.Question(
      question: "Which features?", header: "Features",
      options: [.init(label: "Auth"), .init(label: "Billing")], multiSelect: true),
  ]

  @Test("formats the way the desktop formats")
  func formats() {
    let answer = Questions.formatAnswer(
      questions: questions,
      picks: [0: ["Postgres"], 1: ["Auth", "Billing", Questions.customKey]],
      custom: [1: "and metrics"])
    #expect(
      answer == """
        The user answered:
        - Database: Postgres
        - Features: Auth, Billing — note: and metrics
        """)
  }

  @Test("a bare custom answer carries no note prefix")
  func customOnly() {
    let answer = Questions.formatAnswer(
      questions: questions,
      picks: [0: [Questions.customKey], 1: ["Auth"]],
      custom: [0: "MySQL"])
    #expect(answer.contains("- Database: MySQL"))
    #expect(!answer.contains("note: MySQL"))
  }

  @Test("round-trips back into selections")
  func roundTrip() {
    let answer = Questions.formatAnswer(
      questions: questions,
      picks: [0: ["SQLite"], 1: ["Billing", Questions.customKey]],
      custom: [1: "plus invoices"])
    let parsed = Questions.parseAnswer(answer, questions: questions)
    #expect(parsed[0]?.picks == ["SQLite"])
    #expect(parsed[1]?.picks == ["Billing"])
    #expect(parsed[1]?.note == "plus invoices")
  }

  @Test("prefers the longest matching label")
  func longestLabelWins() {
    let tricky = [
      Questions.Question(
        question: "Ship it?", header: nil,
        options: [.init(label: "Yes"), .init(label: "Yes, always")], multiSelect: false)
    ]
    let parsed = Questions.parseAnswer(
      "The user answered:\n- Ship it?: Yes, always", questions: tricky)
    #expect(parsed[0]?.picks == ["Yes, always"])
  }
}
