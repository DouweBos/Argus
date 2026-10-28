import ArgusCore
import Foundation
import Testing

@MainActor
struct HostLinkModelTests {
  @Test func startsWithItsSurfaceAndFollowsTheHost() async throws {
    let backend = FakeBackend()
    backend.reply(
      command: "account_login_start",
      #"{"kind":"awaiting_claim","user_code":"WDJB-MJHT","verification_uri":"https://x/link","verification_uri_complete":"https://x/link?c","expires_at":0}"#)
    let model = HostLinkModel(surface: .menubar)
    model.pollInterval = .milliseconds(10)
    backend.reply(
      command: "account_get_status",
      #"{"linked":true,"config":{"enabled":true,"service_url":"x","grants":{"ios":"control","desktop":"admin"},"publish":{"lan":true,"tailscale":true,"cloudflare":true},"hosts_can_approve":true,"tunnel":true},"link":{"kind":"linked"}}"#)
    await model.start(backend)
    #expect(await eventually {
      if case .linked = model.state { true } else { false }
    })
    #expect(model.failure == nil)
  }

  @Test func saysWhyWhenTheHostRefuses() async {
    let backend = FakeBackend()
    backend.fail(command: "account_login_start")
    let model = HostLinkModel(surface: .mac)
    await model.start(backend)
    #expect(model.state == nil)
    #expect(model.failure?.contains("Couldn't reach the host") == true)
  }
}
