import Foundation
import Testing

@testable import ArgusKit

@Suite("Host skew")
struct HostSkewTests {
  @Test func readsTheStructuredReason() {
    let payload = GatewayErrorPayload(
      code: "not_found", message: "whatever the host says",
      data: .object(["reason": .string("unknown_command"), "method": .string("usage.limits")]))
    #expect(payload.unsupportedMethod == "usage.limits")
  }

  @Test func readsOlderHostsText() {
    let command = GatewayErrorPayload(code: "not_found", message: "unknown command usage.limits")
    let method = GatewayErrorPayload(code: "capability_denied", message: "unknown method proposals.get")
    #expect(command.unsupportedMethod == "usage.limits")
    #expect(method.unsupportedMethod == "proposals.get")
  }

  @Test func leavesOtherErrorsAlone() {
    for message in [
      "device lacks 'admin' capability", "unknown agent abc", "unknown command", "host-only command x",
      "unknown command a b",
    ] {
      #expect(GatewayErrorPayload(code: "capability_denied", message: message).unsupportedMethod == nil)
    }
    let otherReason = GatewayErrorPayload(
      code: "bad_request", message: "nope", data: .object(["reason": .string("something_else")]))
    #expect(otherReason.unsupportedMethod == nil)
  }

  @Test func explainsWithAndWithoutTheHostVersion() {
    let known = Transport.TransportError.unsupported(method: "usage.limits", hostVersion: "0.68.0")
    let unknown = Transport.TransportError.unsupported(method: "usage.limits", hostVersion: nil)
    #expect(
      known.localizedDescription
        == "This needs a newer version of Argus. The host you're connected to is running 0.68.0.")
    #expect(
      unknown.localizedDescription
        == "This needs a newer version of Argus than the host you're connected to is running.")
  }
}
