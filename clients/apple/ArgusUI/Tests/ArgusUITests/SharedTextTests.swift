import ArgusKit
import Foundation
import Testing

@testable import ArgusUI

@Suite("Shared account and automation text")
struct SharedTextTests {
  private static func member(_ role: AccountMember.Role, kind: String? = nil, platform: String? = nil)
    -> AccountMember
  {
    AccountMember(
      id: "m", role: role, kind: kind, platform: platform, signPub: "", noisePub: "", name: "n",
      createdAt: 0)
  }

  @Test("a computer is a computer on both apps")
  func memberKinds() {
    #expect(AccountMemberText.kind(Self.member(.host, platform: "darwin")) == "Mac computer")
    #expect(AccountMemberText.kind(Self.member(.host, platform: "linux")) == "Linux computer")
    #expect(AccountMemberText.kind(Self.member(.device, kind: "ios")) == "iPhone")
    #expect(AccountMemberText.icon(Self.member(.device, kind: "electron")) == Icon.desktop)
    #expect(AccountMemberText.groupedCode("482093") == "482 093")
    #expect(AccountMemberText.groupedCode("48209") == "48209")
    #expect(AccountMemberText.detail(Self.member(.device, kind: "ios"), code: "482093").hasSuffix("code 482 093"))
  }

  @Test("presence reads online, or when it was last seen")
  func presence() {
    #expect(AccountPresenceText.text(online: true, lastSeen: nil) == "Online")
    #expect(AccountPresenceText.text(online: false, lastSeen: nil) == "Offline")
    let now = Date(timeIntervalSince1970: 10_000)
    #expect(
      AccountPresenceText.text(online: false, lastSeen: 3_000_000, now: now)
        .hasPrefix("Offline · last seen"))
  }

  @Test("a decided proposal says what happened to it")
  func decidedNote() {
    func note(_ status: String, accepted: String? = nil, cleared: String? = nil) -> String? {
      AutomationText.decidedNote(
        status: status, automation: "Triage", acceptedNote: accepted, dismissedReason: nil,
        resolvedNote: nil, clearedReason: cleared)
    }
    #expect(note("pending") == nil)
    #expect(note("accepted") == "You started this.")
    #expect(note("accepted", accepted: "small") == "You started this, with the note: small")
    #expect(note("superseded", cleared: "merged") == "A later run of Triage proposed the same work again: merged")
    #expect(note("withdrawn") == "Triage withdrew this — the signal behind it went away.")
  }

  @Test("run status and start stage read the same off either wire shape")
  func runStatus() {
    #expect(RemoteAutomationRunStatus.failed.tone == .danger)
    #expect(ArgusProtocol.AutomationRunStatus(rawValue: "skipped").tone == .warning)
    #expect(RemoteAutomationRunStatus.queued.tone == .accent)
    #expect(AutomationText.stage("setting_up") == "Running setup…")
    #expect(AutomationText.stage(nil) == "Starting…")
  }
}
