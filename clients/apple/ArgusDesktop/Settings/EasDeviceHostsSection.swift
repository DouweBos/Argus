import ArgusCore
import ArgusUI
import SwiftUI

/// EAS Simulator hosts: iOS simulators in Expo's cloud, each opened device a
/// session billed to the Expo account. The host keeps the token; this never
/// sees a saved one back.
struct EasDeviceHostsSection: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var hosts: [ArgusProtocol.EasDeviceHost]?
  @State private var editing: String?

  var body: some View {
    SettingsGroup(
      "EAS Simulator hosts",
      footer: "Stream and drive iOS simulators in Expo's cloud. Each device you open starts an EAS Simulator "
        + "session billed to your Expo account until you close it, it goes idle, or it reaches its session "
        + "minutes. Removing a host or quitting Argus stops its sessions. The token stays in this Mac's "
        + "secure storage; without one Argus uses EXPO_TOKEN, then your eas login."
    ) {
      if let hosts {
        if hosts.isEmpty {
          Text("No EAS Simulator hosts yet.").foregroundStyle(.secondary)
        }
        ForEach(hosts, id: \.id) { entry in
          if editing == entry.id {
            EasHostForm(existing: entry) {
              editing = nil
              await load()
            } onCancel: {
              editing = nil
            }
          } else {
            EasHostRow(entry: entry, onEdit: { editing = entry.id }) { await load() }
          }
        }
      } else {
        SettingsLoading()
      }
      EasHostForm(existing: nil) { await load() }
    }
    .task(id: host.loaded) { await load() }
  }

  private func load() async {
    hosts = await host.run(ArgusProtocol.Commands.ListEasDeviceHosts.self, EmptyParams()) ?? hosts ?? []
  }
}

enum EasHostText {
  static func account(_ a: ArgusProtocol.EasAccount) -> String {
    let source =
      switch a.credentialSource {
      case .settings: "the saved access token"
      case .env: "EXPO_TOKEN"
      case .easLogin: "the eas login session"
      default: a.credentialSource.rawValue
      }
    let projects = a.apps.count == 1 ? "1 EAS project" : "\(a.apps.count) EAS projects"
    return "Signed in as \(a.signedInAs) via \(source) · \(projects)"
  }

  static func summary(_ h: ArgusProtocol.EasDeviceHost) -> String {
    let running = h.runningSessions > 0 ? "\(Int(h.runningSessions)) running · " : ""
    let credential = h.hasToken ? "token saved" : "EXPO_TOKEN or eas login"
    return "\(running)up to \(Int(h.maxConcurrentSessions)) × \(Int(h.maxSessionMinutes)) min, "
      + "idle \(Int(h.idleMinutes)) min · \(credential)"
  }
}

private struct EasHostRow: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(\.theme) private var theme
  let entry: ArgusProtocol.EasDeviceHost
  let onEdit: () -> Void
  let onChanged: () async -> Void
  @State private var busy = false
  @State private var message: String?
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 10) {
        StatusDot(tone: tone)
        VStack(alignment: .leading, spacing: 2) {
          Text(entry.label).font(.scaled(size: 13, weight: .medium))
          Text("EAS Simulator · \(EasHostText.summary(entry))")
            .font(.scaled(size: 11).monospaced())
            .foregroundStyle(theme.textMuted)
            .lineLimit(1)
            .truncationMode(.middle)
        }
        Spacer()
        Button("Check Account", action: check).disabled(busy)
        Button("Edit", action: onEdit).disabled(busy)
        Button("Remove", role: .destructive, action: remove).disabled(busy)
      }
      if let text = error ?? message ?? entry.error {
        Text(text)
          .font(.scaled(.caption))
          .foregroundStyle(error != nil || (message == nil && entry.error != nil) ? theme.error : theme.textMuted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var tone: Tone {
    if entry.error != nil { return .danger }
    return entry.runningSessions > 0 ? .success : .muted
  }

  private func check() {
    busy = true
    Task {
      defer { busy = false }
      do {
        if let account = try await host.backend?.request(
          ArgusProtocol.Commands.CheckEasAccount.self, .init(hostId: entry.id))
        {
          message = EasHostText.account(account)
          error = nil
        }
      } catch {
        self.error = HostStore.describe(error)
      }
    }
  }

  private func remove() {
    busy = true
    Task {
      defer { busy = false }
      await host.run(ArgusProtocol.Commands.RemoveEasDeviceHost.self, .init(id: entry.id))
      await onChanged()
    }
  }
}

/// Add a host, or edit one: an empty token field keeps the saved token.
private struct EasHostForm: View {
  @Environment(HostSettingsModel.self) private var host
  @Environment(\.theme) private var theme
  let existing: ArgusProtocol.EasDeviceHost?
  let onSaved: () async -> Void
  var onCancel: (() -> Void)?
  @State private var label = ""
  @State private var token = ""
  @State private var appId = ""
  @State private var sessionMinutes = "30"
  @State private var idleMinutes = "10"
  @State private var concurrent = "2"
  @State private var account: ArgusProtocol.EasAccount?
  @State private var busy = false
  @State private var error: String?

  init(
    existing: ArgusProtocol.EasDeviceHost?, onSaved: @escaping () async -> Void,
    onCancel: (() -> Void)? = nil
  ) {
    self.existing = existing
    self.onSaved = onSaved
    self.onCancel = onCancel
    if let existing {
      _label = State(initialValue: existing.label)
      _appId = State(initialValue: existing.appId ?? "")
      _sessionMinutes = State(initialValue: String(Int(existing.maxSessionMinutes)))
      _idleMinutes = State(initialValue: String(Int(existing.idleMinutes)))
      _concurrent = State(initialValue: String(Int(existing.maxConcurrentSessions)))
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        SecureField(
          "Expo access token", text: $token,
          prompt: Text(
            existing?.hasToken == true
              ? "Access token saved (type to replace)" : "Expo access token (empty: EXPO_TOKEN or eas login)"))
        TextField("Label", text: $label, prompt: Text("Label (optional)")).frame(width: 160)
      }
      if let apps = account?.apps, !apps.isEmpty {
        Picker("EAS project", selection: $appId) {
          Text(apps.count == 1 ? "The account's only project" : "Choose an EAS project").tag("")
          ForEach(apps, id: \.id) { app in Text(app.fullName).tag(app.id) }
        }
      } else {
        TextField(
          "EAS project ID", text: $appId,
          prompt: Text("EAS project ID (optional with one project; Check Account lists them)"))
      }
      HStack {
        limit("Session minutes", $sessionMinutes, help: "1–115 (free accounts: 40)")
        limit("Idle minutes", $idleMinutes, help: "1–60, below session minutes")
        limit("Concurrent sessions", $concurrent, help: "1–20")
      }
      HStack {
        Button("Check Account", action: check)
        Button(existing == nil ? "Add EAS Host" : "Save", action: save)
        if existing?.hasToken == true {
          Button("Forget Token", action: forgetToken)
        }
        if let onCancel {
          Button("Cancel", action: onCancel)
        }
        if busy { ProgressView().controlSize(.small) }
      }
      .disabled(busy)
      if let text = error ?? account.map(EasHostText.account) {
        Text(text)
          .font(.scaled(.caption))
          .foregroundStyle(error == nil ? theme.textMuted : theme.error)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .textFieldStyle(.roundedBorder)
    .labelsHidden()
  }

  private func limit(_ title: String, _ value: Binding<String>, help: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
      TextField(title, text: value).help(help)
    }
  }

  /// An unparseable number goes through as 0 so the host explains the range.
  private func number(_ text: String) -> Double? {
    let trimmed = text.trimmingCharacters(in: .whitespaces)
    return trimmed.isEmpty ? nil : Double(trimmed) ?? 0
  }

  private func check() {
    busy = true
    Task {
      defer { busy = false }
      do {
        account = try await host.backend?.request(
          ArgusProtocol.Commands.CheckEasAccount.self,
          .init(hostId: existing?.id, token: token.isEmpty ? nil : token))
        error = nil
      } catch {
        account = nil
        self.error = HostStore.describe(error)
      }
    }
  }

  private func save() {
    busy = true
    Task {
      defer { busy = false }
      do {
        if let existing {
          _ = try await host.backend?.request(
            ArgusProtocol.Commands.UpdateEasDeviceHost.self,
            .init(
              appId: appId, idleMinutes: number(idleMinutes), label: label,
              maxConcurrentSessions: number(concurrent), maxSessionMinutes: number(sessionMinutes),
              token: token.isEmpty ? nil : token, id: existing.id))
        } else {
          _ = try await host.backend?.request(
            ArgusProtocol.Commands.AddEasDeviceHost.self,
            .init(
              appId: appId, idleMinutes: number(idleMinutes), label: label.isEmpty ? nil : label,
              maxConcurrentSessions: number(concurrent), maxSessionMinutes: number(sessionMinutes),
              token: token.isEmpty ? nil : token))
          label = ""
          appId = ""
          account = nil
        }
        token = ""
        error = nil
        await onSaved()
      } catch {
        self.error = HostStore.describe(error)
      }
    }
  }

  private func forgetToken() {
    guard let existing else { return }
    busy = true
    Task {
      defer { busy = false }
      await host.run(ArgusProtocol.Commands.UpdateEasDeviceHost.self, .init(token: "", id: existing.id))
      await onSaved()
    }
  }
}
