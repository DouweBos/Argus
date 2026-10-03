import ArgusCore
import Foundation
import Testing

private func status(
  endpoints: [ArgusProtocol.RemoteEndpoint] = [],
  tunnels: [String: ArgusProtocol.RemoteTunnelState] = [:]
) -> ArgusProtocol.RemoteStatus {
  .init(
    enabled: true, tailscaleEnabled: false, cloudflareEnabled: false, tunnels: tunnels,
    endpoints: endpoints, tunnelMode: .quick, hasTunnelToken: false, notifyWhenFocused: false,
    devices: [], connectedDeviceIds: [])
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
    let failed = ArgusProtocol.RemoteTunnelState(status: .error, error: "boom")
    #expect(RemoteAccessLabels.reachabilityLabel(status(tunnels: ["cloudflare": failed])) == "unreachable")
    #expect(RemoteAccessLabels.reachabilityLabel(status()) == "starting")
  }

  @Test func publishedButUnreachableTunnelSaysSo() {
    let state = ArgusProtocol.RemoteTunnelState(status: .running, publicUrl: "wss://a", reachable: false)
    #expect(RemoteAccessLabels.tunnelLabel(state) == "unreachable")
    #expect(RemoteAccessLabels.tunnelTone(state) == .error)
    let up = ArgusProtocol.RemoteTunnelState(status: .running, publicUrl: "wss://a")
    #expect(RemoteAccessLabels.tunnelLabel(up) == "wss://a")
    #expect(RemoteAccessLabels.tunnelTone(up) == .success)
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
  private let phone = PairingClient(product: "Argus Remote", kind: .mobile, device: "iPhone")
  private let mac = PairingClient(product: "Argus for Mac", kind: .desktop)

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
