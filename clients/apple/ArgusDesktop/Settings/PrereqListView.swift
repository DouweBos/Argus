import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// Runs a set of prereq checks on sight and offers the host's fixer where it
/// has one, else how to install it by hand.
struct PrereqListView: View {
  @Environment(HostSettingsModel.self) private var host
  let ids: [ArgusProtocol.PrereqId]
  @State private var results: [String: ArgusProtocol.PrereqResult] = [:]
  @State private var fixing: ArgusProtocol.PrereqId?
  @State private var checking = false

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      ForEach(ids, id: \.rawValue) { id in
        PrereqRow(
          id: id, result: results[id.rawValue], fixing: fixing == id,
          fix: { fix(id) }, open: { open($0) })
      }
      Button("Re-run Checks") { Task { await check(ids) } }
        .buttonStyle(.borderless)
        .disabled(checking)
    }
    .padding(.leading, 12)
    .task(id: ids.map(\.rawValue)) { await check(ids) }
  }

  private func check(_ ids: [ArgusProtocol.PrereqId]) async {
    checking = true
    defer { checking = false }
    let fresh = await host.run(ArgusProtocol.Commands.OnboardingCheckPrereqs.self, .init(ids: ids)) ?? []
    for result in fresh { results[result.id.rawValue] = result }
  }

  private func fix(_ id: ArgusProtocol.PrereqId) {
    fixing = id
    Task {
      let outcome = await host.run(ArgusProtocol.Commands.OnboardingRunFixer.self, .init(id: id))
      if outcome?.ok == false { host.error = outcome?.error }
      MacTelemetry.capture(.settingsChanged(setting: .prereqFixed))
      await check([id])
      fixing = nil
    }
  }

  /// Through the host's platform open, so a dev build's dry-open catches it.
  private func open(_ url: String) {
    Task { await host.run(ArgusProtocol.Commands.OpenExternalUrl.self, .init(url: url)) }
  }
}

private struct PrereqRow: View {
  @Environment(\.theme) private var theme
  let id: ArgusProtocol.PrereqId
  let result: ArgusProtocol.PrereqResult?
  let fixing: Bool
  let fix: () -> Void
  let open: (String) -> Void

  var body: some View {
    let meta = PrereqMeta.of(id)
    let failing = result?.status == .fail || result?.status == .warn
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 8) {
        icon
        Text(meta.title)
        if let message = fixing ? "Installing…" : result?.message {
          Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(2)
        }
        Spacer()
        // Git identity needs a name and email; Settings → Git owns that form.
        if result?.fixable == true, id != .gitIdentity {
          Button(fixing ? "Installing…" : "Install", action: fix).disabled(fixing)
        }
      }
      if failing, !fixing {
        if let command = meta.installCommand {
          Text(command).font(.caption.monospaced()).textSelection(.enabled)
        }
        if let url = meta.installURL {
          Button("How to install: \(meta.installLabel ?? url)") { open(url) }
            .buttonStyle(.link)
            .font(.caption)
        }
      }
    }
  }

  @ViewBuilder private var icon: some View {
    switch result?.status {
    case nil:
      ProgressView().controlSize(.mini)
    case .some(.pass):
      Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.success)
    case .some(.fail):
      Image(systemName: "xmark.circle.fill").foregroundStyle(theme.error)
    default:
      Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(theme.warning)
    }
  }
}
