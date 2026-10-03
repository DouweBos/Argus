import ArgusCore
import Foundation
import Testing

private func guest(_ label: String, _ state: ArgusProtocol.HuddleGuestState, typing: Bool = false)
  -> ArgusProtocol.HuddleGuestModel
{
  .init(
    memberId: label, devStaticPub: "pub-\(label)", label: label, state: state, joinedAt: 0,
    connected: true, typing: typing)
}

private func room(_ guests: [ArgusProtocol.HuddleGuestModel]) -> ArgusProtocol.HuddleRoomModel {
  .init(
    id: "r", token: "t", agentId: "a", deviceKey: "", createdAt: 0, expiresAt: 0, guests: guests,
    hostTyping: false, hostLabel: "", chat: [])
}

struct HuddlesTests {
  @Test func splitsGuestsByState() {
    let r = room([guest("Ana", .pending), guest("Ben", .approved, typing: true), guest("Cy", .denied)])
    #expect(Huddles.pending(r).map(\.label) == ["Ana"])
    #expect(Huddles.approved(r).map(\.label) == ["Ben"])
    #expect(Huddles.typingNames(r) == ["Ben"])
    #expect(Huddles.pending(nil).isEmpty)
  }

  @Test func typingLineMatchesPeacock() {
    #expect(Huddles.typingLine([]) == nil)
    #expect(Huddles.typingLine(["Ana"]) == "Ana is typing")
    #expect(Huddles.typingLine(["Ana", "Ben"]) == "Ana and Ben are typing")
    #expect(Huddles.typingLine(["Ana", "Ben", "Cy", "Di"]) == "Ana, Ben and 2 others are typing")
  }

  @Test func inviteDegradesAPhraseAtATime() {
    #expect(
      Huddles.inviteText(name: "Ana", agentTitle: "Fix login", url: "https://x")
        == "Ana wants you to join “Fix login” in Argus — https://x")
    #expect(Huddles.inviteText(name: " ", agentTitle: "", url: "") == "You're invited to join an agent in Argus")
  }

  @Test func shareableDeviceKeyFollowsThePlatform() {
    #expect(Huddles.shareableDeviceKey(platform: "ios", iosUdid: "U", androidSerial: "S", sessionId: "s") == "U")
    #expect(Huddles.shareableDeviceKey(platform: "android", iosUdid: nil, androidSerial: nil, sessionId: "s") == "")
    #expect(Huddles.shareableDeviceKey(platform: "web", iosUdid: nil, androidSerial: nil, sessionId: "s") == "browser:s")
  }

  @Test func hostNamePrefersTheSetting() {
    #expect(Huddles.hostName(configured: "  Ana ", gitName: "ana-git") == "Ana")
    #expect(Huddles.hostName(configured: "", gitName: "ana-git") == "ana-git")
    #expect(Huddles.hostName(configured: "", gitName: nil) == "")
  }
}

@MainActor
struct HuddleTypingReporterTests {
  @Test func sendsOnceThenRenews() {
    var sent: [Bool] = []
    var clock = ContinuousClock.now
    let reporter = HuddleTypingReporter(renew: .seconds(4), idle: .seconds(60), now: { clock }) {
      sent.append($0)
    }
    reporter.keystroke()
    reporter.keystroke()
    #expect(sent == [true])
    clock = clock.advanced(by: .seconds(5))
    reporter.keystroke()
    #expect(sent == [true, true])
    reporter.stop()
    reporter.stop()
    #expect(sent == [true, true, false])
  }

  @Test func goesQuietAfterIdle() async throws {
    var sent: [Bool] = []
    let reporter = HuddleTypingReporter(idle: .milliseconds(20)) { sent.append($0) }
    reporter.keystroke()
    try await Task.sleep(for: .milliseconds(200))
    #expect(sent == [true, false])
  }
}
