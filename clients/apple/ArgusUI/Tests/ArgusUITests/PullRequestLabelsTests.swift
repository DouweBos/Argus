import Testing

@testable import ArgusUI

@Suite("Pull request labels")
struct PullRequestLabelsTests {
  @Test("reasons and review decisions read as words")
  func labels() {
    #expect(PullRequestLabels.reason("team") == "Team review")
    #expect(PullRequestLabels.reason("assignee") == "Assignee")
    #expect(PullRequestLabels.review("CHANGES_REQUESTED")?.label == "Changes requested")
    #expect(PullRequestLabels.review("WHATEVER") == nil)
  }

  @Test("a missing or signed-out gh says how to fix it")
  func explain() {
    #expect(PullRequestLabels.explain("spawn gh ENOENT").contains("gh auth login"))
    #expect(PullRequestLabels.explain("You are not logged into any GitHub hosts").contains("isn't signed in"))
    #expect(PullRequestLabels.explain("rate limited") == "rate limited")
  }
}
