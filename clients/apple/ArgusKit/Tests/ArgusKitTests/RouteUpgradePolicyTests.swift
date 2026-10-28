import Foundation
import Testing

@testable import ArgusKit

@Suite struct RouteUpgradePolicyTests {
  let lan = RemoteEndpoint(kind: .lan, url: "ws://192.168.1.20:47615", priority: 0)
  let tailscale = RemoteEndpoint(kind: .tailscale, url: "ws://100.100.1.2:47615", priority: 1)
  let tunnel = RemoteEndpoint(kind: .cloudflare, url: "wss://argus-abc.houwert.dev", priority: 2)
  var all: [RemoteEndpoint] { [lan, tailscale, tunnel] }
  let t0 = Date(timeIntervalSince1970: 1_000_000)

  @Test func nothingToDoOnTheBestRoute() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: lan, now: t0)
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0) == .none)
  }

  @Test func pathChangeTriesOnlyBetterRoutes() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: tunnel, now: t0)
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0) == .upgrade([lan, tailscale]))
  }

  @Test func timerWaitsForTheRecheckInterval() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: tailscale, now: t0)
    #expect(policy.plan(candidates: all, trigger: .timer, now: t0 + 60) == .none)
    #expect(policy.plan(candidates: all, trigger: .timer, now: t0 + 121) == .upgrade([lan]))
  }

  @Test func failedPreflightBacksOffAndDoubles() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: tunnel, now: t0)
    policy.checked([lan, tailscale], winner: nil, now: t0)
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 30) == .none)
    #expect(policy.plan(candidates: all, trigger: .timer, now: t0 + 121) == .upgrade([lan, tailscale]))
    policy.checked([lan, tailscale], winner: nil, now: t0 + 121)
    // Second failure: two minutes this time, not one.
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 121 + 100) == .none)
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 121 + 121) == .upgrade([lan, tailscale]))
  }

  @Test func onlyRoutesAboveTheWinnerAreHeldBack() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: tunnel, now: t0)
    policy.checked([lan, tailscale], winner: tailscale, now: t0)
    policy.connected(via: tailscale, upgraded: true, now: t0)
    #expect(policy.coolingDown(lan.url, now: t0 + 1))
    #expect(!policy.coolingDown(tailscale.url, now: t0 + 1))
  }

  @Test func aNewNetworkLiftsTheBackOff() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: tunnel, now: t0)
    policy.checked([lan, tailscale], winner: nil, now: t0)
    policy.pathChanged()
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 5) == .upgrade([lan, tailscale]))
  }

  @Test func aSwitchThatDropsQuicklyIsHeldEvenAcrossNetworks() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: tunnel, now: t0)
    policy.connected(via: lan, upgraded: true, now: t0 + 10)
    policy.connectionLost(now: t0 + 20)
    policy.pathChanged()
    // Down: re-race, but without the route that just bounced.
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 25) == .rerace([tailscale, tunnel]))
    policy.connected(via: tunnel, now: t0 + 30)
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 35) == .upgrade([tailscale]))
  }

  @Test func aStableSwitchThatDropsLaterIsNotHeld() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: lan, upgraded: true, now: t0)
    policy.connectionLost(now: t0 + 600)
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 601) == .rerace(all))
  }

  @Test func downRacesEverythingOnTheTimerToo() {
    var policy = RouteUpgradePolicy()
    #expect(policy.plan(candidates: all, trigger: .timer, now: t0) == .rerace(all))
    policy.connected(via: lan, now: t0)
    policy.connectionLost(now: t0 + 1)
    #expect(policy.plan(candidates: all, trigger: .timer, now: t0 + 2) == .none)
    #expect(policy.plan(candidates: all, trigger: .timer, now: t0 + 121) == .rerace(all))
    policy.connectionRestored()
    #expect(policy.plan(candidates: all, trigger: .timer, now: t0 + 121) == .none)
  }

  @Test func downWithEveryRouteHeldStillTriesThemAll() {
    var policy = RouteUpgradePolicy()
    policy.checked(all, winner: nil, now: t0)
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 1) == .rerace(all))
  }

  @Test func droppingItOnPurposeHoldsNothingBack() {
    var policy = RouteUpgradePolicy()
    policy.connected(via: lan, upgraded: true, now: t0)
    policy.disconnected()
    #expect(!policy.coolingDown(lan.url, now: t0 + 1))
    #expect(policy.plan(candidates: all, trigger: .pathChanged, now: t0 + 1) == .rerace(all))
  }
}
