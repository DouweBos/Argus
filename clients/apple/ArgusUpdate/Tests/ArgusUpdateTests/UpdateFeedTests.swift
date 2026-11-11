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

@MainActor
struct UpdateChannelSyncTests {
  private struct Down: Error {}

  @Test func aFailedReadKeepsTheChannelAndALaterOneFollowsTheHost() async {
    var feed = UpdateFeed(product: "argus-mac", channel: .latest)
    var answer: String?? = nil
    var logged = 0
    let sync = UpdateChannelSync(
      load: {
        guard let answer else { throw Down() }
        return answer
      },
      apply: { feed.channel = $0 },
      log: { _ in logged += 1 })

    #expect(await sync.sync() == false)
    #expect(feed.channel == .latest)
    #expect(logged == 1)

    answer = .some("beta")
    #expect(await sync.sync())
    #expect(feed.url.lastPathComponent == "argus-mac-beta.xml")

    answer = .some(nil)
    await sync.sync()
    #expect(feed.channel == .latest)
  }

  @Test func onlyTheChannelKeyTriggersAResync() {
    #expect(UpdateChannelSync.affects(settings: ["theme", "updater_channel"]))
    #expect(!UpdateChannelSync.affects(settings: ["theme"]))
  }
}
