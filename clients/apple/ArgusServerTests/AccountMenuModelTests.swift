import ArgusCore
import Foundation
import Testing

@testable import Argus_Server

/// Mirrors `electron/services/tray/accountMenu.test.ts`: one menu, two apps.
struct AccountMenuModelTests {
  typealias F = Fixtures
  let linked = F.status(linked: true, safetyCode: "ABCD-EFGH")

  @Test func offersLinkingWhenNotLinked() {
    let menu = AccountMenuModel.items(F.account())
    #expect(F.labels(menu) == ["Link to Argus Account…"])
    #expect(F.action(F.find(menu, "Link to Argus Account…")) == .account(.linkStart))
  }

  @Test func showsTheCodeAndWhereToEnterIt() {
    let claim = ArgusProtocol.AccountLinkStateAwaitingClaim(
      kind: "awaiting_claim", userCode: "WDJB-MJHT", verificationUri: "https://houwert.dev/argus/link",
      verificationUriComplete: "https://houwert.dev/argus/link?code=WDJB-MJHT", expiresAt: 0)
    let menu = AccountMenuModel.items(F.account(F.status(link: .awaitingClaim(claim))))
    #expect(F.labels(menu).first == "Enter WDJB-MJHT at houwert.dev/argus/link")
    #expect(
      F.action(F.find(menu, "Open houwert.dev/argus/link"))
        == .account(.linkOpen("https://houwert.dev/argus/link?code=WDJB-MJHT")))
    #expect(F.action(F.find(menu, "Copy Code")) == .account(.linkCopyCode("WDJB-MJHT")))
    #expect(F.action(F.find(menu, "Cancel Linking")) == .account(.linkCancel))
  }

  @Test func asksForTheSixDigitComparisonBeforeLinking() {
    let sas = ArgusProtocol.AccountLinkStateAwaitingSas(kind: "awaiting_sas", sas: "482093", approverName: "iPhone")
    let menu = AccountMenuModel.items(F.account(F.status(link: .awaitingSas(sas))))
    #expect(F.labels(menu).contains("Confirm this matches: 482 093"))
    #expect(F.action(F.find(menu, "Codes Match — Link")) == .account(.linkConfirm(match: true)))
    #expect(F.action(F.find(menu, "Codes Differ — Cancel")) == .account(.linkConfirm(match: false)))
  }

  @Test func showsStatusPresenceAndTheTunnelWhenLinked() {
    let menu = AccountMenuModel.items(
      F.account(linked, tunnel: .init(phase: .running, url: "wss://abc.tunnel.houwert.dev"), online: true))
    #expect(
      Array(F.labels(menu).prefix(3)) == [
        "Argus Account: linked as \"Mini\"", "Online", "Managed tunnel: abc.tunnel.houwert.dev",
      ])
    let settings = F.children(F.find(menu, "Argus Account"))
    #expect(F.find(settings, "Managed Tunnel") == .toggle("Managed Tunnel", isOn: true, .account(.tunnel(on: false))))
    #expect(F.action(F.find(settings, "Unlink…")) == .account(.unlink))
    #expect(!F.labels(settings).contains("Use System Name (Mini)"))
    #expect(F.labels(settings).first == "Account safety code: ABCD-EFGH")
  }

  @Test func offersTheSystemNameBackOnceRenamed() {
    let menu = AccountMenuModel.items(F.account(F.status(linked: true, name: "Build box")))
    let settings = F.children(F.find(menu, "Argus Account"))
    #expect(F.action(F.find(settings, "Use System Name (Mini)")) == .account(.renameDefault))
    #expect(F.action(F.find(settings, "This Computer's Name…")) == .account(.rename(current: "Build box")))
  }

  @Test func listsWhoIsWaitingWithApproveAndDeny() {
    let menu = AccountMenuModel.items(F.account(linked, requests: [F.request]))
    let row = F.find(F.children(F.find(menu, "Waiting to join (1)")), "Douwe's iPhone (device)")
    #expect(F.children(row).map(F.action) == [.account(.approve(requestId: "r1")), .account(.deny(requestId: "r1"))])
  }

  @Test func honoursApprovingBeingOff() {
    var config = F.config
    config.hostsCanApprove = false
    let menu = AccountMenuModel.items(F.account(F.status(linked: true, config: config), requests: [F.request]))
    #expect(F.find(menu, "Waiting to join (1) — approving here is off") == .info("Waiting to join (1) — approving here is off"))
  }

  @Test func asksForTheComparisonWhileApproving() {
    let approval = ArgusProtocol.AccountApprovalStateAwaitingSas(
      kind: "awaiting_sas", requestId: "r1", sas: "123456", subjectName: "Douwe's iPhone", subjectRole: .device)
    let menu = AccountMenuModel.items(F.account(linked, approval: .awaitingSas(approval), requests: [F.request]))
    #expect(F.labels(menu).contains("Confirm this matches: 123 456"))
    #expect(F.action(F.find(menu, "Codes Differ — Deny")) == .account(.approvalConfirm(match: false)))
    if case .submenu(_, _, let enabled)? = F.find(menu, "Waiting to join (1)") {
      #expect(!enabled)
    } else {
      Issue.record("no waiting submenu")
    }
  }

  @Test func putsAFailedActionOnTopUntilDismissed() {
    let menu = AccountMenuModel.items(F.account(notice: "That request is gone"))
    #expect(Array(F.labels(menu).prefix(2)) == ["That request is gone", "Dismiss"])
  }

  @Test func tunnelLinesSayWhyItIsOff() {
    #expect(AccountMenuModel.tunnelLine(.init(phase: .off, reason: .remoteOff)) == "Managed tunnel: off (remote access is off)")
    #expect(AccountMenuModel.tunnelLine(.init(phase: .off, reason: .accountPaused)) == "Managed tunnel: paused")
    #expect(AccountMenuModel.tunnelLine(.init(phase: .installing)) == "Managed tunnel: installing cloudflared…")
    #expect(AccountMenuModel.tunnelLine(.init(phase: .error)) == "Managed tunnel: failed")
  }
}
