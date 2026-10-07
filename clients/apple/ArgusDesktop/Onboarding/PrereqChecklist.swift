import ArgusCore
import ArgusUI
import SwiftUI

/// The desktop's prereq checklist: each check's live status, an Install button
/// where the host has a fixer, the git identity form, and how to install the rest.
struct PrereqChecklist: View {
  let ids: [PrereqId]
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  private var checks: PrereqChecks { .shared }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(ids, id: \.rawValue) { id in
        PrereqRow(id: id, result: checks.results[id])
        if id != ids.last { Divider() }
      }
      HStack {
        if let error = checks.fixError {
          Text(error).font(.scaled(.caption)).foregroundStyle(theme.error)
        }
        Spacer()
        Button("Re-run checks") {
          guard let backend = model.backend else { return }
          Task { await checks.run(backend, ids: ids, force: true) }
        }
        .disabled(checks.running)
      }
      .padding(.top, 10)
    }
  }
}

private struct PrereqRow: View {
  let id: PrereqId
  let result: PrereqResult?
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  private var checks: PrereqChecks { .shared }

  private var status: ArgusProtocol.PrereqStatus { result?.status ?? .running }
  private var fixing: Bool { checks.fixing == id }
  private var failing: Bool { !fixing && (status == .fail || status == .warn) }

  var body: some View {
    HStack(alignment: .top, spacing: 10) {
      icon.frame(width: 18)
      VStack(alignment: .leading, spacing: 4) {
        Text(SetupChecks.meta(id).title).font(.scaled(size: 13, weight: .semibold))
        if let message = fixing ? "Installing…" : result?.message {
          Text(message).foregroundStyle(theme.textSecondary)
        }
        if let detail = result?.detail, !detail.isEmpty {
          Text(detail).font(.scaled(.caption)).foregroundStyle(theme.textMuted).textSelection(.enabled)
        }
        if id == .gitIdentity, status != .pass, status != .running {
          GitIdentityForm(busy: fixing) { name, email in
            guard let backend = model.backend else { return }
            Task { await checks.fix(backend, .gitIdentity, gitName: name, gitEmail: email) }
          }
        } else if failing {
          installHint
        }
      }
      Spacer(minLength: 0)
      if result?.fixable == true, id != .gitIdentity, id != .claudeAuth, status != .pass {
        Button(fixing ? "Installing…" : "Install") {
          guard let backend = model.backend else { return }
          Task { await checks.fix(backend, id) }
        }
        .disabled(fixing)
      }
    }
    .padding(.vertical, 10)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(SetupChecks.meta(id).title): \(status.rawValue)")
  }

  @ViewBuilder private var icon: some View {
    switch fixing ? .running : status {
    case .pass: Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.success)
    case .warn: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(theme.warning)
    case .fail: Image(systemName: "xmark.circle.fill").foregroundStyle(theme.error)
    case .skipped: Image(systemName: "minus.circle").foregroundStyle(theme.textMuted)
    default: ProgressView().controlSize(.small)
    }
  }

  @ViewBuilder private var installHint: some View {
    let meta = SetupChecks.meta(id)
    if let command = meta.installCommand {
      Text(command)
        .font(.scaled(size: 12, design: .monospaced))
        .textSelection(.enabled)
        .padding(.horizontal, 8).padding(.vertical, 4)
        .background(theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
    if let url = meta.installURL.flatMap(URL.init(string:)) {
      HStack(spacing: 4) {
        Text("How to install:").foregroundStyle(theme.textMuted)
        Link(meta.installLabel ?? url.absoluteString, destination: url)
          .buttonStyle(.accentLink)
      }
      .font(.scaled(.caption))
    }
  }
}

/// Name and email, written to the global git config by the host's fixer.
struct GitIdentityForm: View {
  let busy: Bool
  let onSubmit: (String, String) -> Void
  @State private var name = ""
  @State private var email = ""

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      TextField("Name", text: $name, prompt: Text("Your Name")).frame(maxWidth: 180)
      TextField("Email", text: $email, prompt: Text("you@example.com")).frame(maxWidth: 220)
      Button(busy ? "Saving…" : "Save") {
        onSubmit(name.trimmingCharacters(in: .whitespaces), email.trimmingCharacters(in: .whitespaces))
      }
      .disabled(busy || !SetupChecks.isValidIdentity(name: name, email: email))
    }
    .textFieldStyle(.roundedBorder)
    .labelsHidden()
  }
}
