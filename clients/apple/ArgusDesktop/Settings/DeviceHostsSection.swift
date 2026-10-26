import ArgusCore
import ArgusUI
import SwiftUI

/// Other Macs whose iOS simulators the host streams over SSH. The host owns the
/// config and the connections; this lists, adds, tests and removes them.
struct DeviceHostsSection: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var hosts: [ArgusProtocol.DeviceHost]?
  @State private var results: [String: ArgusProtocol.DeviceHostTestResult] = [:]
  @State private var busy: Set<String> = []

  var body: some View {
    SettingsGroup(
      "Device hosts",
      footer: "Stream and drive iOS simulators running on another Mac. Argus connects with this Mac's SSH "
        + "config and keys, never prompts for a password, and installs its bridge on the other Mac on first "
        + "use. Stored in ~/.argus/device-hosts.json."
    ) {
      if let hosts {
        if hosts.isEmpty {
          Text("No device hosts yet.").foregroundStyle(.secondary)
        }
        ForEach(hosts, id: \.id) { entry in
          DeviceHostRow(
            entry: entry, result: results[entry.id], busy: busy.contains(entry.id),
            onTest: { test(entry) }, onRemove: { remove(entry) })
        }
      } else {
        SettingsLoading()
      }
      AddDeviceHostForm { await load() }
    }
    .task(id: host.loaded) { await load() }
  }

  private func load() async {
    hosts = await host.run(ArgusProtocol.Commands.ListDeviceHosts.self, EmptyParams()) ?? hosts ?? []
  }

  private func test(_ entry: ArgusProtocol.DeviceHost) {
    busy.insert(entry.id)
    Task {
      defer { busy.remove(entry.id) }
      let input = ArgusProtocol.DeviceHostInput(
        identityFile: entry.identityFile, label: entry.label, port: entry.port, target: entry.target)
      results[entry.id] = await host.run(ArgusProtocol.Commands.TestDeviceHost.self, input)
      await load()
    }
  }

  private func remove(_ entry: ArgusProtocol.DeviceHost) {
    busy.insert(entry.id)
    Task {
      defer { busy.remove(entry.id) }
      await host.run(ArgusProtocol.Commands.RemoveDeviceHost.self, .init(id: entry.id))
      results[entry.id] = nil
      await load()
    }
  }
}

private struct DeviceHostRow: View {
  @Environment(\.theme) private var theme
  let entry: ArgusProtocol.DeviceHost
  let result: ArgusProtocol.DeviceHostTestResult?
  let busy: Bool
  let onTest: () -> Void
  let onRemove: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 10) {
        StatusDot(tone: tone)
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.label).font(.scaled(size: 13, weight: .medium))
          Text(target)
            .font(.scaled(size: 11).monospaced())
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
            .truncationMode(.middle)
        }
        Spacer()
        Button("Test", action: onTest).disabled(busy)
        Button("Remove", role: .destructive, action: onRemove).disabled(busy)
      }
      if let message = result?.message ?? entry.error {
        Text(message)
          .font(.scaled(.caption))
          .foregroundStyle(failed ? theme.error : theme.textMuted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var failed: Bool {
    if let result { return !result.ok }
    return entry.error != nil
  }

  private var tone: Tone {
    switch entry.status {
    case .connected: .success
    case .unreachable: .danger
    default: .muted
    }
  }

  private var target: String {
    var text = entry.target
    if let port = entry.port { text += ":\(Int(port))" }
    if let identity = entry.identityFile { text += " · \(identity)" }
    return text
  }
}

/// A draft host: test it first, or add it straight away.
private struct AddDeviceHostForm: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(\.theme) private var theme
  let onAdded: () async -> Void
  @State private var target = ""
  @State private var port = ""
  @State private var identityFile = ""
  @State private var label = ""
  @State private var busy = false
  @State private var result: ArgusProtocol.DeviceHostTestResult?
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        TextField("SSH target", text: $target, prompt: Text("SSH alias or user@host"))
        TextField("Port", text: $port, prompt: Text("Port")).frame(width: 70)
      }
      HStack {
        TextField("Identity file", text: $identityFile, prompt: Text("Identity file (optional)"))
        TextField("Label", text: $label, prompt: Text("Label (optional)"))
      }
      HStack {
        Button("Test Connection", action: test)
        Button("Add Host", action: add).keyboardShortcut(.defaultAction)
        if busy { ProgressView().controlSize(.small) }
      }
      .disabled(busy || target.trimmingCharacters(in: .whitespaces).isEmpty)
      if let message = error ?? result?.message {
        Text(message)
          .font(.scaled(.caption))
          .foregroundStyle(error == nil && result?.ok == true ? theme.textMuted : theme.error)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .textFieldStyle(.roundedBorder)
    .labelsHidden()
    .onChange(of: [target, port, identityFile, label]) {
      result = nil
      error = nil
    }
  }

  private var input: ArgusProtocol.DeviceHostInput {
    ArgusProtocol.DeviceHostInput(
      identityFile: identityFile.isEmpty ? nil : identityFile,
      label: label.isEmpty ? nil : label,
      // An unparseable port goes through as 0 so the host explains what's wrong.
      port: port.trimmingCharacters(in: .whitespaces).isEmpty ? nil : Double(port) ?? 0,
      target: target)
  }

  private func test() {
    busy = true
    Task {
      defer { busy = false }
      do {
        result = try await host.backend?.request(ArgusProtocol.Commands.TestDeviceHost.self, input)
      } catch {
        self.error = HostStore.describe(error)
      }
    }
  }

  private func add() {
    busy = true
    Task {
      defer { busy = false }
      do {
        _ = try await host.backend?.request(ArgusProtocol.Commands.AddDeviceHost.self, input)
        target = ""
        port = ""
        identityFile = ""
        label = ""
        await onAdded()
      } catch {
        self.error = HostStore.describe(error)
      }
    }
  }
}
