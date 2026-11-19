package dev.houwert.argus.kit.net

import dev.houwert.argus.kit.net.RouteUpgradePolicy.Plan
import dev.houwert.argus.kit.net.RouteUpgradePolicy.Trigger
import dev.houwert.argus.kit.storage.RemoteEndpoint
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

class RouteUpgradePolicyTest {
  private val lan = RemoteEndpoint(RemoteEndpoint.Kind.Lan, "ws://192.168.1.20:47615", 0)
  private val tailscale = RemoteEndpoint(RemoteEndpoint.Kind.Tailscale, "ws://100.100.1.2:47615", 1)
  private val tunnel = RemoteEndpoint(RemoteEndpoint.Kind.Cloudflare, "wss://argus-abc.houwert.dev", 2)
  private val all = listOf(lan, tailscale, tunnel)
  private val t0 = Instant.ofEpochSecond(1_000_000)
  private fun at(seconds: Long) = t0.plusSeconds(seconds)

  @Test fun nothingToDoOnTheBestRoute() {
    val policy = RouteUpgradePolicy()
    policy.connected(lan, now = t0)
    assertEquals(Plan.None, policy.plan(all, Trigger.PathChanged, t0))
  }

  @Test fun pathChangeTriesOnlyBetterRoutes() {
    val policy = RouteUpgradePolicy()
    policy.connected(tunnel, now = t0)
    assertEquals(Plan.Upgrade(listOf(lan, tailscale)), policy.plan(all, Trigger.PathChanged, t0))
  }

  @Test fun timerWaitsForTheRecheckInterval() {
    val policy = RouteUpgradePolicy()
    policy.connected(tailscale, now = t0)
    assertEquals(Plan.None, policy.plan(all, Trigger.Timer, at(60)))
    assertEquals(Plan.Upgrade(listOf(lan)), policy.plan(all, Trigger.Timer, at(121)))
  }

  @Test fun failedPreflightBacksOffAndDoubles() {
    val policy = RouteUpgradePolicy()
    policy.connected(tunnel, now = t0)
    policy.checked(listOf(lan, tailscale), winner = null, now = t0)
    assertEquals(Plan.None, policy.plan(all, Trigger.PathChanged, at(30)))
    assertEquals(Plan.Upgrade(listOf(lan, tailscale)), policy.plan(all, Trigger.Timer, at(121)))
    policy.checked(listOf(lan, tailscale), winner = null, now = at(121))
    // Second failure: two minutes this time, not one.
    assertEquals(Plan.None, policy.plan(all, Trigger.PathChanged, at(121 + 100)))
    assertEquals(Plan.Upgrade(listOf(lan, tailscale)), policy.plan(all, Trigger.PathChanged, at(121 + 121)))
  }

  @Test fun onlyRoutesAboveTheWinnerAreHeldBack() {
    val policy = RouteUpgradePolicy()
    policy.connected(tunnel, now = t0)
    policy.checked(listOf(lan, tailscale), winner = tailscale, now = t0)
    policy.connected(tailscale, upgraded = true, now = t0)
    assertTrue(policy.coolingDown(lan.url, at(1)))
    assertFalse(policy.coolingDown(tailscale.url, at(1)))
  }

  @Test fun aNewNetworkLiftsTheBackOff() {
    val policy = RouteUpgradePolicy()
    policy.connected(tunnel, now = t0)
    policy.checked(listOf(lan, tailscale), winner = null, now = t0)
    policy.pathChanged()
    assertEquals(Plan.Upgrade(listOf(lan, tailscale)), policy.plan(all, Trigger.PathChanged, at(5)))
  }

  @Test fun aSwitchThatDropsQuicklyIsHeldEvenAcrossNetworks() {
    val policy = RouteUpgradePolicy()
    policy.connected(tunnel, now = t0)
    policy.connected(lan, upgraded = true, now = at(10))
    policy.connectionLost(at(20))
    policy.pathChanged()
    // Down: re-race, but without the route that just bounced.
    assertEquals(Plan.Rerace(listOf(tailscale, tunnel)), policy.plan(all, Trigger.PathChanged, at(25)))
    policy.connected(tunnel, now = at(30))
    assertEquals(Plan.Upgrade(listOf(tailscale)), policy.plan(all, Trigger.PathChanged, at(35)))
  }

  @Test fun aStableSwitchThatDropsLaterIsNotHeld() {
    val policy = RouteUpgradePolicy()
    policy.connected(lan, upgraded = true, now = t0)
    policy.connectionLost(at(600))
    assertEquals(Plan.Rerace(all), policy.plan(all, Trigger.PathChanged, at(601)))
  }

  @Test fun downRacesEverythingOnTheTimerToo() {
    val policy = RouteUpgradePolicy()
    assertEquals(Plan.Rerace(all), policy.plan(all, Trigger.Timer, t0))
    policy.connected(lan, now = t0)
    policy.connectionLost(at(1))
    assertEquals(Plan.None, policy.plan(all, Trigger.Timer, at(2)))
    assertEquals(Plan.Rerace(all), policy.plan(all, Trigger.Timer, at(121)))
    policy.connectionRestored()
    assertEquals(Plan.None, policy.plan(all, Trigger.Timer, at(121)))
  }

  @Test fun downWithEveryRouteHeldStillTriesThemAll() {
    val policy = RouteUpgradePolicy()
    policy.checked(all, winner = null, now = t0)
    assertEquals(Plan.Rerace(all), policy.plan(all, Trigger.PathChanged, at(1)))
  }

  @Test fun droppingItOnPurposeHoldsNothingBack() {
    val policy = RouteUpgradePolicy()
    policy.connected(lan, upgraded = true, now = t0)
    policy.disconnected()
    assertFalse(policy.coolingDown(lan.url, at(1)))
    assertEquals(Plan.Rerace(all), policy.plan(all, Trigger.PathChanged, at(1)))
  }

  @Test fun aPathSignatureAnnouncesOnlyRealChanges() {
    val signature = NetworkPathSignature()
    assertFalse(signature.swap("wifi"))
    assertFalse(signature.swap("wifi"))
    assertTrue(signature.swap("cellular"))
  }
}
