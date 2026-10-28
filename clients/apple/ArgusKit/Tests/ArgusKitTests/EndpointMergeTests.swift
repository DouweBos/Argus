import Testing

@testable import ArgusKit

@Suite struct EndpointMergeTests {
  let lan = RemoteEndpoint(kind: .lan, url: "ws://192.168.1.20:47615", priority: 0)
  let tailscale = RemoteEndpoint(kind: .tailscale, url: "wss://mac.tail.ts.net", priority: 1)
  let cloudflare = RemoteEndpoint(kind: .cloudflare, url: "wss://a.trycloudflare.com", priority: 2)

  @Test func keepsAnAddressThatIsNotLiveRightNow() {
    let merged = DeviceIdentity.mergedEndpoints(known: [lan, tailscale], live: [lan])
    #expect(merged == [lan, tailscale])
  }

  @Test func replacesAnAddressThatMoved() {
    let newLan = RemoteEndpoint(kind: .lan, url: "ws://10.0.0.5:47615", priority: 0)
    let merged = DeviceIdentity.mergedEndpoints(known: [lan, tailscale], live: [newLan])
    #expect(merged == [newLan, tailscale])
  }

  @Test func learnsNewAddresses() {
    let merged = DeviceIdentity.mergedEndpoints(known: [lan], live: [lan, cloudflare])
    #expect(merged == [lan, cloudflare])
  }

  @Test func keepsWhatItKnowsWhenNothingIsLive() {
    let merged = DeviceIdentity.mergedEndpoints(known: [lan, tailscale], live: [])
    #expect(merged == [lan, tailscale])
  }

  @Test func startsFromScratch() {
    let merged = DeviceIdentity.mergedEndpoints(known: nil, live: [tailscale, lan])
    #expect(merged == [lan, tailscale])
  }
}

@Suite struct EndpointKindTests {
  @Test func tailnetAddressesAreTailscale() {
    #expect(DeviceIdentity.inferEndpointKind("ws://100.101.102.103:47615") == .tailscale)
    #expect(DeviceIdentity.inferEndpointKind("ws://100.64.0.1:47615") == .tailscale)
    #expect(DeviceIdentity.inferEndpointKind("ws://100.127.255.254:1") == .tailscale)
    #expect(DeviceIdentity.inferEndpointKind("wss://mac.tail1234.ts.net") == .tailscale)
  }

  @Test func outsideTheTailnetRangeIsLan() {
    #expect(DeviceIdentity.inferEndpointKind("ws://100.63.0.1:47615") == .lan)
    #expect(DeviceIdentity.inferEndpointKind("ws://100.128.0.1:47615") == .lan)
    #expect(DeviceIdentity.inferEndpointKind("ws://192.168.1.20:47615") == .lan)
    #expect(DeviceIdentity.inferEndpointKind("ws://mac.local:47615") == .lan)
  }

  @Test func tlsIsATunnel() {
    #expect(DeviceIdentity.inferEndpointKind("wss://argus-abc123.houwert.dev") == .cloudflare)
    #expect(DeviceIdentity.inferEndpointKind("wss://a-b-c.trycloudflare.com") == .cloudflare)
  }
}
