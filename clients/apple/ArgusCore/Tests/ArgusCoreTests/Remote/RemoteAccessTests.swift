import ArgusCore
import Foundation
import Testing

private func status(
  endpoints: [ArgusProtocol.RemoteEndpoint] = [],
  managed: ArgusProtocol.ManagedTunnelState = .init(phase: .starting),
  legacy: [ArgusProtocol.LegacyTunnelState] = []
) -> ArgusProtocol.RemoteStatus {
  .init(
    enabled: true, endpoints: endpoints, managedTunnel: managed, legacyTunnels: legacy,
    notifyWhenFocused: false, devices: [], connectedDeviceIds: [])
}

struct RemoteAccessLabelsTests {
  @Test func reachabilityCountsWaysIn() {
    let lan = ArgusProtocol.RemoteEndpoint(kind: .lan, url: "ws://10.0.0.2:1", priority: 0)
    let cf = ArgusProtocol.RemoteEndpoint(kind: .cloudflare, url: "wss://x", priority: 2)
    #expect(RemoteAccessLabels.reachabilityLabel(status(endpoints: [lan])) == "1 way in")
    #expect(RemoteAccessLabels.reachabilityLabel(status(endpoints: [lan, cf])) == "2 ways in")
    #expect(RemoteAccessLabels.reachabilityTone(status(endpoints: [lan])) == .success)
    #expect(RemoteAccessLabels.orderedEndpoints(status(endpoints: [cf, lan])).map(\.kind) == [.lan, .cloudflare])
  }

  @Test func failedTunnelWithNoAddressIsUnreachable() {
    let failed = ArgusProtocol.ManagedTunnelState(phase: .error, error: "boom")
    #expect(RemoteAccessLabels.reachabilityLabel(status(managed: failed)) == "unreachable")
    let legacy = ArgusProtocol.LegacyTunnelState(kind: .cloudflareQuick, status: .error, error: "boom")
    #expect(RemoteAccessLabels.reachabilityTone(status(legacy: [legacy])) == .error)
    #expect(RemoteAccessLabels.reachabilityLabel(status()) == "starting")
  }

  @Test func managedTunnelReadsInWords() {
    let running = ArgusProtocol.ManagedTunnelState(phase: .running, url: "wss://argus-a.houwert.dev")
    #expect(RemoteAccessLabels.managedTunnelLabel(running) == "running")
    #expect(RemoteAccessLabels.managedTunnelTone(running) == .success)
    #expect(RemoteAccessLabels.managedTunnelNote(running) == nil)
    let error = ArgusProtocol.ManagedTunnelState(phase: .error, error: "boom")
    #expect(RemoteAccessLabels.managedTunnelTone(error) == .error)
    #expect(RemoteAccessLabels.managedTunnelLabel(.init(phase: .provisioning)) == "setting up")
    #expect(RemoteAccessLabels.managedTunnelTone(.init(phase: .provisioning)) == .idle)
  }

  @Test func offTunnelSaysWhy() {
    let notLinked = ArgusProtocol.ManagedTunnelState(phase: .off, reason: .notLinked)
    #expect(RemoteAccessLabels.managedTunnelNote(notLinked)?.contains("Sign in") == true)
    #expect(RemoteAccessLabels.managedTunnelNote(.init(phase: .off, reason: .remoteOff)) == "Starts when remote access is on.")
    #expect(RemoteAccessLabels.managedTunnelNote(.init(phase: .unavailable)) != nil)
    #expect(RemoteAccessLabels.managedTunnelTone(notLinked) == .idle)
  }

  @Test func legacyTunnelsShowTheirAddress() {
    let up = ArgusProtocol.LegacyTunnelState(kind: .tailscaleFunnel, status: .running, publicUrl: "wss://a.ts.net")
    #expect(RemoteAccessLabels.legacyTunnel(up.kind) == "Tailscale Funnel")
    #expect(RemoteAccessLabels.legacyTunnelLabel(up) == "wss://a.ts.net")
    #expect(RemoteAccessLabels.legacyTunnelTone(up) == .success)
    let starting = ArgusProtocol.LegacyTunnelState(kind: .cloudflareToken, status: .starting)
    #expect(RemoteAccessLabels.legacyTunnelLabel(starting) == "starting")
  }

  @Test func lastSeenBuckets() {
    let now = Date(timeIntervalSince1970: 1_000_000)
    let ms = now.timeIntervalSince1970 * 1000
    #expect(RemoteAccessLabels.lastSeen(nil, now: now) == "never connected")
    #expect(RemoteAccessLabels.lastSeen(ms - 10_000, now: now) == "just now")
    #expect(RemoteAccessLabels.lastSeen(ms - 5 * 60_000, now: now) == "5m ago")
    #expect(RemoteAccessLabels.lastSeen(ms - 3 * 3_600_000, now: now) == "3h ago")
    #expect(RemoteAccessLabels.lastSeen(ms - 50 * 3_600_000, now: now) == "2d ago")
  }

  @Test func grantsAndWebClient() {
    #expect(RemoteAccessLabels.grants([.monitor]) == "monitor only")
    #expect(RemoteAccessLabels.grants([.monitor, .control]) == "monitor + control")
    #expect(RemoteAccessLabels.grants([.monitor, .control, .admin]) == "full control (admin)")
    #expect(RemoteAccessLabels.webClientUrl("ws://10.0.0.2:4000") == "http://10.0.0.2:4000")
    #expect(RemoteAccessLabels.webClientUrl(nil) == "no LAN address")
  }
}

struct PairingFlowTests {
  private let phone = PairingClientInfo(product: "Argus Remote", kind: "mobile", device: "iPhone")
  private let mac = PairingClientInfo(product: "Argus for Mac", kind: "desktop")

  @Test func labelsTheClient() {
    #expect(phone.label == "Argus Remote on iPhone")
    #expect(mac.label == "Argus for Mac")
  }

  @Test func onlyDesktopsAreOfferedAdmin() {
    var flow = PairingFlow()
    flow.starting()
    flow.started(qrPayload: "argus://pair", pairingCode: "CODE")
    flow.grantAdmin = true
    flow.sas("123456", client: phone)
    #expect(!flow.offersAdmin)
    #expect(!flow.grantAdmin)
    flow.sas("123456", client: nil)
    #expect(flow.offersAdmin)
  }

  @Test func adminImpliesControl() {
    var flow = PairingFlow()
    flow.sas("123456", client: mac)
    flow.grantAdmin = true
    #expect(flow.grants == (true, true))
    flow.grantAdmin = false
    flow.grantControl = false
    #expect(flow.grants == (false, false))
  }

  @Test func phasesAdvance() {
    var flow = PairingFlow()
    flow.started(qrPayload: "x", pairingCode: "y")
    #expect(flow.phase == .idle)
    flow.starting()
    flow.started(qrPayload: "x", pairingCode: "y")
    #expect(flow.phase == .waitingForDevice(qrPayload: "x", pairingCode: "y"))
    flow.sas("654321", client: mac)
    flow.confirmSent()
    #expect(flow.phase == .confirmingSent(sas: "654321", client: mac))
    flow.completed(label: "Argus for Mac")
    #expect(flow.phase == .paired(label: "Argus for Mac"))
  }
}
