import ArgusCore
import ArgusUI
import SwiftUI

/// "Link this Mac with a code": when this Mac can't join the account itself,
/// its host links the way `argus-host login` does — it shows a code, you add
/// it on your phone, and both sides compare the 6-digit code.
struct MacHostLinkSection: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var link = MacHostLink()

  var body: some View {
    SettingsGroup(
      "Link this Mac with a code",
      footer: "On your phone: Settings → Account → Add a computer, then type this code. Codes last 10 minutes."
    ) {
      switch link.state {
      case .none, .idle:
        HStack {
          Text("Put this Mac's host on your account.").foregroundStyle(.secondary)
          Spacer()
          Button("Get a Code") { Task { await link.start(model.localBackend) } }
            .buttonStyle(.accent)
            .disabled(model.localBackend == nil)
        }
      case .awaitingClaim(let claim):
        HStack {
          Text(claim.userCode)
            .font(.scaled(size: 24, weight: .semibold, design: .monospaced))
            .textSelection(.enabled)
          Spacer()
          ProgressView().controlSize(.small)
          Button("Cancel") { Task { await link.cancel() } }.buttonStyle(.secondary)
        }
      case .awaitingFirst:
        HStack {
          Text("Your account is empty. Make this Mac the first on it?")
          Spacer()
          Button("Make It the First") { Task { await link.confirm(true) } }
            .buttonStyle(.accent)
          Button("Cancel") { Task { await link.cancel() } }.buttonStyle(.secondary)
        }
      case .awaitingSas(let sas):
        VStack(alignment: .leading, spacing: 8) {
          Text("\(sas.approverName) is adding this Mac. Only confirm if it shows the same code:")
            .foregroundStyle(.secondary)
          Text("\(sas.sas.prefix(3)) \(sas.sas.suffix(3))")
            .font(.scaled(size: 28, weight: .semibold, design: .monospaced))
          HStack {
            Button("Codes Match") { Task { await link.confirm(true) } }
              .buttonStyle(.accent)
            Button("They Don't Match", role: .destructive) { Task { await link.confirm(false) } }
              .buttonStyle(.secondary)
          }
        }
      case .awaitingApproval:
        HStack {
          ProgressView().controlSize(.small)
          Text("Waiting for your phone to finish…").foregroundStyle(.secondary)
        }
      case .linked:
        Label("This Mac's host is on your account.", systemImage: "checkmark.circle")
          .foregroundStyle(theme.success)
      case .error(let error):
        HStack {
          SettingsError(text: error.message)
          Spacer()
          Button("Try Again") { Task { await link.start(model.localBackend) } }
            .buttonStyle(.accent)
        }
      case .unknown:
        EmptyView()
      }
    }
    .onDisappear { link.stopPolling() }
  }
}

/// The host's link state machine, driven over the local socket.
@MainActor
@Observable
final class MacHostLink {
  private(set) var state: ArgusProtocol.AccountLinkState?
  @ObservationIgnored private var backend: (any HostBackend)?
  @ObservationIgnored private var poll: Task<Void, Never>?

  func start(_ backend: (any HostBackend)?) async {
    guard let backend else { return }
    self.backend = backend
    state = try? await backend.request(ArgusProtocol.Commands.AccountLoginStart.self, .init(surface: .mac))
    startPolling()
  }

  func confirm(_ match: Bool) async {
    guard let backend else { return }
    state = try? await backend.request(ArgusProtocol.Commands.AccountLoginConfirm.self, .init(match: match))
  }

  func cancel() async {
    stopPolling()
    guard let backend else { return }
    state = try? await backend.request(ArgusProtocol.Commands.AccountLoginCancel.self, EmptyParams())
  }

  /// The host moves on its own (claimed, approver found); read where it is.
  private func startPolling() {
    poll?.cancel()
    poll = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(2))
        guard let self, let backend = self.backend,
          let status = try? await backend.request(ArgusProtocol.Commands.AccountGetStatus.self, EmptyParams())
        else { continue }
        self.state = status.link
        switch status.link {
        case .linked, .error, .idle: return
        default: continue
        }
      }
    }
  }

  func stopPolling() {
    poll?.cancel()
    poll = nil
  }
}
