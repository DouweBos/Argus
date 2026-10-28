import ArgusCore
import ArgusUI
import SwiftUI

/// Settings → Hosts: the client half of remote access — machines this Mac
/// drives. Pairing runs against a code from the other machine's Remote screen.
struct HostsSettingsTab: View {
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(AccountStore.self) private var account
  @State private var code = ""

  var body: some View {
    SettingsPage {
      SettingsGroup(
        "Pair a host",
        footer: "Paste the pairing code shown on the other Mac's Remote screen (or by `argus-host`), compare the 6-digit code, and approve it there with Admin ticked. A headless Mac mini and a workstation look identical from here."
      ) {
        HStack {
          TextField("Pairing code", text: $code)
            .textFieldStyle(.roundedBorder)
            .font(.system(.body, design: .monospaced))
            .disabled(isPairing)
            .onSubmit(pair)
          Button("Pair", action: pair)
            .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || isPairing)
        }
        PairingStatus(code: $code)
      }

      SettingsGroup(
        "Hosts",
        footer: "Attach brings a host's projects into the sidebar and keeps its agents streaming; Show points the screens that aren't about one session (Home, Devices, Automations, Settings) at it. Attached hosts come back on launch. Forget deletes this Mac's key for a host; revoke it there too to be thorough."
      ) {
        if hosts.hosts.isEmpty {
          Text("No hosts yet. Pair one above, or sign in under Argus Account to list the hosts on your account.")
            .foregroundStyle(.secondary)
        } else {
          ForEach(hosts.hosts) { identity in
            PairedHostRow(identity: identity)
          }
        }
      }
    }
    .onDisappear { hosts.clearPairing() }
    // Account hosts' presence moves while this is open.
    .liveRefresh(enabled: account.isSignedIn, every: AccountStore.presencePollInterval) {
      await account.refreshDirectory()
    }
  }

  private var isPairing: Bool {
    switch hosts.pairing {
    case .connecting, .confirm: true
    default: false
    }
  }

  private func pair() {
    guard !isPairing, !code.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    hosts.startPairing(code: code)
  }
}

private struct PairingStatus: View {
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(\.theme) private var theme
  @Binding var code: String

  var body: some View {
    switch hosts.pairing {
    case .idle:
      EmptyView()
    case .connecting:
      HStack {
        ProgressView().controlSize(.small)
        Text("Connecting to the host…").foregroundStyle(.secondary)
        Spacer()
        Button("Cancel") { hosts.cancelPairing() }
      }
    case .confirm(let sas):
      VStack(alignment: .leading, spacing: 8) {
        Text("Check this code matches the one on the host, then approve it there with Admin ticked:")
          .foregroundStyle(.secondary)
        HStack {
          Text(sas)
            .font(.scaled(size: 28, weight: .semibold, design: .monospaced))
            .textSelection(.enabled)
            .accessibilityLabel("Pairing check code \(sas)")
          Spacer()
          Button("Cancel") { hosts.cancelPairing() }
        }
      }
    case .paired(let label, let admin):
      VStack(alignment: .leading, spacing: 4) {
        Label("Paired with \(label).", systemImage: "checkmark.circle")
          .foregroundStyle(theme.success)
        if !admin {
          Text("It didn't grant Admin, so it will refuse most of what this Mac asks. Pair again and tick Admin on the host.")
            .foregroundStyle(theme.warning)
        }
      }
      .onAppear { code = "" }
    case .failed(let message):
      Text(message).foregroundStyle(theme.error)
    }
  }
}

private struct PairedHostRow: View {
  @Environment(RemoteHostsStore.self) private var hosts
  @Environment(AccountStore.self) private var account
  @Environment(\.theme) private var theme
  let identity: DeviceIdentity
  @State private var label = ""
  @State private var confirmingForget = false

  private var id: HostId { identity.deviceId }
  private var attached: Bool { hosts.attached.contains(id) }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        if identity.isAccountHost {
          Text(identity.label).font(.scaled(.headline))
        } else {
          TextField("Host name", text: $label)
            .textFieldStyle(.plain)
            .font(.scaled(.headline))
            .onSubmit { hosts.rename(id, to: label) }
            .accessibilityLabel("Host name")
        }
        if let accountHost = identity.accountHostId.flatMap(account.host) {
          Text("Account · \(AccountPresenceText.text(online: accountHost.online, lastSeen: accountHost.lastSeen))")
            .font(.scaled(.caption))
            .foregroundStyle(.secondary)
        }
        Spacer()
        HostStateLabel(state: hosts.state(id))
      }
      HStack(spacing: 6) {
        Text(DeviceIdentity.gatewayHost(identity.url))
        if !identity.isAccountHost, !identity.capabilities.contains("admin") {
          Text("· limited grant — this host will refuse most commands").foregroundStyle(theme.warning)
        }
      }
      .font(.scaled(.caption))
      .foregroundStyle(.secondary)
      HStack {
        if attached {
          Button("Detach") { Task { await hosts.detach(id) } }
          Button(hosts.focused == id ? "Shown" : "Show") { hosts.focus(id) }
            .disabled(hosts.focused == id)
        } else {
          Button("Attach") { hosts.attach(id) }
        }
        Spacer()
        if !identity.isAccountHost {
          Button("Forget…", role: .destructive) { confirmingForget = true }
        }
      }
    }
    .padding(.vertical, 4)
    .onAppear { label = identity.label }
    .onChange(of: identity.label) { _, new in label = new }
    .confirmationDialog(
      "Forget \(identity.label)?", isPresented: $confirmingForget
    ) {
      Button("Forget", role: .destructive) { Task { await hosts.forget(id) } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This Mac deletes its key for that host. Pairing again needs a new code from it.")
    }
  }
}

/// A host's link, as a dot and a word.
struct HostStateLabel: View {
  @Environment(\.theme) private var theme
  let state: RemoteHostsStore.LinkState

  var body: some View {
    HStack(spacing: 6) {
      StatusDot(tone: state.tone)
      Text(state.title).foregroundStyle(theme.textSecondary)
    }
  }
}

extension RemoteHostsStore.LinkState {
  var title: String {
    switch self {
    case .detached: "detached"
    case .connecting: "connecting"
    case .ready: "connected"
    case .offline: "offline — reconnecting"
    case .unreachable: "unreachable — retrying"
    }
  }

  var tone: Tone {
    switch self {
    case .detached: .muted
    case .connecting: .accent
    case .ready: .success
    case .offline, .unreachable: .warning
    }
  }
}
