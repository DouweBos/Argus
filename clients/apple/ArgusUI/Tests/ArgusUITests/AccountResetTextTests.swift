import ArgusCore
import Foundation
import Testing

@testable import ArgusUI

@MainActor
struct AccountResetTextTests {
  @Test func namesWhoResetIt() {
    let notice = AccountResetNotice(epoch: 1, at: nil, byName: "New phone")
    #expect(
      AccountResetNoticeBanner.text(notice, deviceNoun: "Mac")
        == "It was reset from “New phone”. This Mac left it — approve it from New phone to come back.")
  }

  @Test func readsWithoutAName() {
    let notice = AccountResetNotice(epoch: 1, at: nil, byName: nil)
    #expect(
      AccountResetNoticeBanner.text(notice, deviceNoun: "phone")
        == "It was reset. This phone left it — approve it from that device to come back.")
  }
}
