import Testing

@testable import ArgusCore

@Suite("Commit message")
struct CommitMessageTests {
  @Test("a summary alone is the whole message")
  func summaryOnly() {
    #expect(CommitMessage(summary: "  fix: a  ", description: " \n ").text == "fix: a")
  }

  @Test("a description follows a blank line")
  func withDescription() {
    let message = CommitMessage(summary: "feat: b", description: "\nWhy it matters.\n")
    #expect(message.text == "feat: b\n\nWhy it matters.")
    #expect(message.hasDescription)
  }

  @Test("a blank summary can't be committed, whatever the description says")
  func empty() {
    #expect(CommitMessage(summary: " ", description: "body").isEmpty)
  }

  @Test("parsing splits at the first line")
  func parsing() {
    let parsed = CommitMessage(parsing: "feat: c\n\nLine one\nLine two\n")
    #expect(parsed.summary == "feat: c")
    #expect(parsed.description == "Line one\nLine two")
    #expect(CommitMessage(parsing: "only\n").description.isEmpty)
  }
}
