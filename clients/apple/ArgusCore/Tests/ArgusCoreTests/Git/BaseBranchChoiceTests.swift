import Testing

@testable import ArgusCore

@Suite("Base branch choice")
struct BaseBranchChoiceTests {
  @Test("the configured default wins, as a local branch")
  func configured() {
    let picked = BaseBranchChoice.preselected(
      local: ["main", "staging"], originRefs: ["origin/main"], configured: "staging", protected: [],
      projectRootBranch: nil)
    #expect(picked == "staging")
  }

  @Test("the remote tip over a local copy the project root has checked out")
  func checkedOutPrefersOrigin() {
    let picked = BaseBranchChoice.preselected(
      local: ["main", "feature"], originRefs: ["origin/main"], configured: nil, protected: [],
      projectRootBranch: "main")
    #expect(picked == "origin/main")
  }

  @Test("no base-like branch falls back to the first local one")
  func fallback() {
    #expect(
      BaseBranchChoice.preselected(
        local: ["feature"], originRefs: [], configured: nil, protected: [], projectRootBranch: nil) == "feature")
    #expect(
      BaseBranchChoice.preselected(local: [], originRefs: [], configured: nil, protected: [], projectRootBranch: nil)
        == nil)
  }

  @Test("only base-like remote refs are offered")
  func options() {
    let options = BaseBranchChoice.options(
      local: ["main", "feature"], originRefs: ["origin/main", "origin/someone-else", "origin/release"],
      protected: ["release"])
    #expect(options == ["main", "feature", "origin/main", "origin/release"])
  }
}
