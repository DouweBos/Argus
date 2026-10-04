import ArgusCore
import ArgusUI
import Observation
import SwiftUI

/// Testing one MCP server and, for an HTTP one, signing in to it.
@MainActor
@Observable
final class McpProbe {
  enum Status { case unknown, testing, ok, needsAuth, failed }

  private(set) var result: ArgusProtocol.McpTestResult?
  private(set) var testing = false
  private(set) var signingIn = false
  private(set) var signInError: String?
  /// A stored OAuth token for the server's URL.
  private(set) var auth: ArgusProtocol.McpOAuthStatus?

  var status: Status {
    if testing || signingIn { return .testing }
    guard let result else { return auth == nil ? .unknown : .ok }
    if result.ok { return .ok }
    return canSignIn ? .needsAuth : .failed
  }

  var canSignIn: Bool {
    guard let result, !result.ok else { return false }
    return result.status == 401 || result.resourceMetadataUrl != nil
  }

  func test(_ config: [String: JSONValue], backend: HostRouter?, track: Bool = true) async {
    guard let backend else { return }
    testing = true
    defer { testing = false }
    do {
      result = try await backend.request(ArgusProtocol.Commands.TestMcpServer.self, .init(config: config))
    } catch {
      result = ArgusProtocol.McpTestResult(ok: false, transport: .init(rawValue: "unknown"), error: HostStore.describe(error))
    }
    if track { MacTelemetry.capture(.settingsChanged(setting: .mcpTested)) }
  }

  func loadAuth(url: String?, backend: HostRouter?) async {
    guard let url, let backend else { return auth = nil }
    auth = (try? await backend.request(ArgusProtocol.Commands.McpOauthStatus.self, .init(serverUrl: url))) ?? nil
  }

  /// Opens the browser through the host, then re-tests with the new token.
  func signIn(url: String, config: [String: JSONValue], backend: HostRouter?) async {
    guard let backend else { return }
    signingIn = true
    signInError = nil
    do {
      auth = try await backend.request(
        ArgusProtocol.Commands.McpOauthSignIn.self,
        .init(serverUrl: url, resourceMetadataUrl: result?.resourceMetadataUrl))
      signingIn = false
      MacTelemetry.capture(.settingsChanged(setting: .mcpSignedIn))
      await test(config, backend: backend, track: false)
    } catch {
      signingIn = false
      let message = HostStore.describe(error)
      if !message.contains("cancelled") { signInError = message }
    }
  }

  func cancelSignIn(url: String, backend: HostRouter?) async {
    guard let backend else { return }
    _ = try? await backend.request(ArgusProtocol.Commands.McpOauthCancelSignIn.self, .init(serverUrl: url))
  }

  func signOut(url: String, backend: HostRouter?) async {
    guard let backend else { return }
    _ = try? await backend.request(ArgusProtocol.Commands.McpOauthSignOut.self, .init(serverUrl: url))
    auth = nil
    MacTelemetry.capture(.settingsChanged(setting: .mcpSignedOut))
  }
}

struct McpStatusDot: View {
  @Environment(\.theme) private var theme
  let status: McpProbe.Status

  var body: some View {
    Circle()
      .fill(color)
      .frame(width: 8, height: 8)
      .help(label)
      .accessibilityLabel(label)
  }

  private var color: Color {
    switch status {
    case .ok: theme.success
    case .failed, .needsAuth: theme.error
    case .testing: theme.warning
    case .unknown: theme.textMuted
    }
  }

  private var label: String {
    switch status {
    case .ok: "Connected"
    case .failed: "Failed"
    case .needsAuth: "Requires authentication"
    case .testing: "Checking…"
    case .unknown: "Not yet checked"
    }
  }
}

/// Test / Retry, the failure, the tools it offers, and sign in or out.
struct McpProbeControls: View {
  let backend: HostRouter?
  let probe: McpProbe
  let config: [String: JSONValue]?
  let url: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if let tools = probe.result?.tools, probe.result?.ok == true, !tools.isEmpty {
        SettingsCaption("Tools: " + tools.map(\.name).joined(separator: ", "))
      }
      if let result = probe.result, !result.ok, !probe.canSignIn {
        SettingsError(text: [result.error ?? result.status.map { "HTTP \(Int($0))" } ?? "Failed", result.hint]
          .compactMap { $0 }.joined(separator: " — "))
      }
      if let error = probe.signInError { SettingsError(text: "Sign-in failed: \(error)") }
      HStack {
        if probe.testing {
          ProgressView().controlSize(.small)
          Text("Testing…").foregroundStyle(.secondary)
        } else {
          Button(probe.result == nil ? "Test" : "Retry") {
            guard let config else { return }
            Task { await probe.test(config, backend: backend) }
          }
          .disabled(config == nil || probe.signingIn)
        }
        if let url, let config, probe.canSignIn {
          if probe.signingIn {
            Text("Waiting for browser…").foregroundStyle(.secondary)
            Button("Cancel") { Task { await probe.cancelSignIn(url: url, backend: backend) } }
          } else {
            Button(probe.signInError == nil ? "Sign In" : "Try Again") {
              Task { await probe.signIn(url: url, config: config, backend: backend) }
            }
            .buttonStyle(.borderedProminent)
          }
        }
        if let url, probe.auth != nil {
          Label("Signed in", systemImage: "checkmark").foregroundStyle(.secondary)
          Button("Sign Out") { Task { await probe.signOut(url: url, backend: backend) } }
        }
      }
    }
    .task(id: url) { await probe.loadAuth(url: url, backend: backend) }
  }
}
