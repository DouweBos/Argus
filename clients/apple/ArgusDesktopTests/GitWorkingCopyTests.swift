import Foundation
import GroveKit
import Testing

@testable import Argus

@MainActor
struct GitWorkingCopyTests {
  @Test func savingAnIdentityLabelsItAndSkipsOnesAlreadySaved() {
    let identity = CommitIdentity(name: "Ada", email: "ada@work.com")
    let saved = IdentityProfiles.adding(identity, label: "  ", to: [])
    #expect(saved.map(\.label) == ["work.com"])
    #expect(saved.first?.matches(identity) == true)
    #expect(IdentityProfiles.adding(identity, label: "Again", to: saved).count == 1)
    #expect(IdentityProfiles.removing(saved[0].id, from: saved).isEmpty)
  }

  @Test func signingConfigWritesOnlyWhatChangedAndUnsetsEmptyValues() {
    let old = GitSigningConfig(["commit.gpgsign": "true", "gpg.format": "ssh", "user.signingkey": "~/.ssh/id"])
    var next = old
    next.enabled = false
    next.key = "  "
    let changes = next.changes(from: old)
    #expect(changes.map(\.key) == ["commit.gpgsign", "user.signingkey"])
    #expect(changes.map(\.value) == ["", ""])
    #expect(old.changes(from: old).isEmpty)
  }

  @Test func gitDefaultsFallBackToTheListAndKeepWhitespace() throws {
    let defaults = try #require(UserDefaults(suiteName: "argus-tests-\(UUID().uuidString)"))
    #expect(GitPreferences.fileViewMode(defaults) == .flatModified)
    #expect(GitPreferences.ignoreWhitespace(defaults) == false)
    defaults.set(FileViewMode.allFiles.rawValue, forKey: GitPreferences.fileViewModeKey)
    defaults.set(true, forKey: GitPreferences.ignoreWhitespaceKey)
    #expect(GitPreferences.fileViewMode(defaults) == .allFiles)
    #expect(GitPreferences.ignoreWhitespace(defaults))
  }

  @Test func pullStrategiesMapToTheHostsNames() {
    #expect(PullStrategy.fastForwardOnly.wire.rawValue == "ff-only")
    #expect(PullStrategy.rebase.wire.rawValue == "rebase")
  }
}
