import Foundation
import Testing

@testable import ArgusUpdate

struct UpdateFeedTests {
  @Test func feedsArePerProductAndChannel() {
    #expect(
      UpdateFeed(product: "argus-server", channel: .latest).url.absoluteString
        == "https://houwert.dev/argus/updates/argus-server-latest.xml")
    #expect(UpdateFeed(product: "argus-mac", channel: .beta).url.lastPathComponent == "argus-mac-beta.xml")
  }

  @Test func channelFollowsTheElectronSetting() {
    #expect(UpdateChannel(setting: "beta") == .beta)
    #expect(UpdateChannel(setting: nil) == .latest)
    #expect(UpdateChannel(setting: "nightly") == .latest)
  }

  @Test func installWaitsForAReadyUpdateAndIdleAgents() {
    #expect(InstallVerdict(state: .available(version: "1.2.3"), activeAgents: 0) == .notReady)
    #expect(InstallVerdict(state: .ready(version: "1.2.3"), activeAgents: 3) == .agentsRunning(3))
    #expect(InstallVerdict(state: .ready(version: "1.2.3"), activeAgents: 0) == .ok)
  }

  @MainActor
  @Test func aBuildWithoutAKeyNeverLooks() {
    let updater = MenuUpdater(feed: .init(product: "argus-server", channel: .latest), bundle: Bundle(for: Marker.self))
    #expect(updater.state == .unavailable)
    #expect(updater.install(activeAgents: 0) == .notReady)
  }
}

private final class Marker {}
