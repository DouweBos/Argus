import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

extension DesktopModel {
  /// Forward a paired host's port to this Mac; `open` then shows `path` from
  /// it in the default browser.
  func forwardPort(
    _ key: PortForwardsStore.Key, via: MacTelemetryEvent.PortForwardVia, open url: URL? = nil
  ) async {
    do {
      let forward = try await portForwards.start(key)
      MacTelemetry.capture(.portForwarded(action: .start, via: via, success: true))
      if let url { openForwarded(forward, url: url, via: via) }
    } catch is CancellationError {
    } catch {
      MacTelemetry.capture(.portForwarded(action: .start, via: via, success: false))
      notificationsLog.push(
        .error, "Couldn't forward port \(key.port): \(HostStore.describe(error))",
        source: "Port forwarding")
    }
  }

  /// `url`'s path and query, on this Mac's end of the forward.
  func openForwarded(
    _ forward: PortForwardsStore.Forward, url: URL? = nil, via: MacTelemetryEvent.PortForwardVia
  ) {
    var parts = url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
      ?? URLComponents()
    parts.scheme = parts.scheme ?? "http"
    parts.host = "localhost"
    parts.port = forward.localPort
    NSWorkspace.shared.open(parts.url ?? forward.url)
    MacTelemetry.capture(.portForwarded(action: .open, via: via, success: true))
  }

  func stopForward(_ key: PortForwardsStore.Key, via: MacTelemetryEvent.PortForwardVia) {
    portForwards.stop(key)
    MacTelemetry.capture(.portForwarded(action: .stop, via: via, success: true))
  }
}

/// One of a remote session's ports: a button to forward it to this Mac, or,
/// once forwarded, where it landed and a way to stop it.
/// Takes the model directly: a `Table` cell doesn't always inherit the environment.
struct PortForwardControl: View {
  let model: DesktopModel
  let key: PortForwardsStore.Key

  var body: some View {
    if let forward = model.portForwards.forward(key) {
      HStack(spacing: 4) {
        Button("localhost:\(String(forward.localPort))") {
          model.openForwarded(forward, via: .runtimes)
        }
        .buttonStyle(.accentLink)
        .help("Open in your browser")
        Button {
          model.stopForward(key, via: .runtimes)
        } label: {
          Image(systemName: "xmark.circle.fill")
        }
        .buttonStyle(.argusBorderless)
        .foregroundStyle(.secondary)
        .help("Stop forwarding port \(String(key.port))")
      }
    } else {
      Button {
        Task { await model.forwardPort(key, via: .runtimes) }
      } label: {
        Label("Forward \(String(key.port))", systemImage: "arrow.down.left.circle")
      }
      .buttonStyle(.argusBorderless)
      .disabled(model.portForwards.starting.contains(key))
      .help("Forward port \(String(key.port)) to localhost on this Mac")
    }
  }

  /// The ports among a run's workspace variables, e.g. `PORT=8085`.
  static func ports(in env: [TerminalsStore.EnvVar]) -> [Int] {
    var seen = Set<Int>()
    return env.compactMap { variable -> Int? in
      guard variable.name.uppercased().hasSuffix("PORT"), let port = Int(variable.value),
        (1...65535).contains(port), seen.insert(port).inserted
      else { return nil }
      return port
    }
  }
}
