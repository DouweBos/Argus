import ArgusCore
import ArgusUI
import SwiftUI

/// Pin the conductor CLI agents use: Bundled, or any published version at or
/// above it, installed on demand by the host.
struct ConductorVersionSection: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(HostStore.self) private var store
  @State private var status: ArgusProtocol.ConductorStatus?
  @State private var versions: [String] = []
  @State private var listError: String?

  var body: some View {
    SettingsGroup("Conductor") {
      SettingsRow(
        "Conductor version",
        description: "Pin the conductor CLI version agents use. Installed on demand from npm into ~/.argus — no "
          + "app update needed. Only versions at or above the bundled one are listed."
      ) {
        Picker("Conductor version", selection: selection) {
          Text("Bundled" + (status?.bundledVersion.map { " (\($0))" } ?? "")).tag("")
          ForEach(options, id: \.self) { Text($0).tag($0) }
        }
        .disabled(status?.state == .installing || (options.isEmpty && pinned.isEmpty))
      } detail: {
        statusLine
      }
    }
    .task(id: host.loaded) {
      guard let backend = host.backend else { return }
      status = try? await backend.request(ArgusProtocol.Commands.GetConductorStatus.self, EmptyParams())
      do {
        versions = try await backend.request(ArgusProtocol.Commands.ListConductorVersions.self, EmptyParams())
      } catch {
        listError = HostStore.describe(error)
      }
    }
    .onAppear {
      // Install progress arrives as an event while the host provisions it.
      let stop = store.observeIpc { channel, args, _ in
        guard channel == "conductor_status_changed", let payload = args.first,
          let next = try? ProtocolCodec.convert(payload, to: ArgusProtocol.ConductorStatus.self)
        else { return }
        status = next
      }
      unobserve = stop
    }
    .onDisappear { unobserve?() }
  }

  @State private var unobserve: (() -> Void)?

  private var pinned: String { status?.overrideVersion ?? "" }

  /// A pinned version older than this build's list still shows as picked.
  private var options: [String] {
    !pinned.isEmpty && !versions.contains(pinned) ? [pinned] + versions : versions
  }

  private var selection: Binding<String> {
    Binding(
      get: { pinned },
      set: { next in
        Task {
          if let updated = await host.run(
            ArgusProtocol.Commands.SetConductorVersion.self, .init(version: next.isEmpty ? nil : next))
          {
            status = updated
          }
          MacTelemetry.capture(.settingsChanged(setting: .conductorVersion))
        }
      })
  }

  @ViewBuilder private var statusLine: some View {
    if let status {
      switch status.state {
      case .installing:
        HStack {
          ProgressView().controlSize(.small)
          SettingsCaption("Installing conductor v\(status.overrideVersion ?? "")…")
        }
      case .error:
        SettingsError(
          text: "\(status.error ?? "Install failed.") Using bundled v\(status.bundledVersion ?? "unknown").")
      default:
        if let listError {
          SettingsError(text: listError)
        } else if status.overrideVersion != nil, status.state == .ready {
          SettingsCaption("Using pinned conductor v\(status.activeVersion ?? "")")
        } else {
          SettingsCaption("Using bundled conductor v\(status.bundledVersion ?? "unknown").")
        }
      }
    }
  }
}
