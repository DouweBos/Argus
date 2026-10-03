import ArgusCore
import ArgusUI
import SwiftUI

/// Each Funnel prerequisite (CLI, service, sign-in, Funnel) with its one-click
/// fix — the desktop's `TailscaleSetup` checklist.
struct TailscaleSetupView: View {
  @Environment(\.theme) private var theme
  let model: RemoteSettingsModel

  private var busy: Bool { model.tailscaleChecking || model.tailscaleFixing != nil }

  var body: some View {
    Group {
      ForEach(model.tailscale?.steps ?? [], id: \.id.rawValue) { step in
        HStack(alignment: .top, spacing: 10) {
          icon(step)
          VStack(alignment: .leading, spacing: 2) {
            Text(step.title).fontWeight(.medium)
            Text(step.message).font(.callout).foregroundStyle(theme.textSecondary)
            if let detail = step.detail {
              Text(detail).font(.system(.caption, design: .monospaced)).foregroundStyle(theme.textMuted)
                .textSelection(.enabled)
            }
          }
          Spacer()
          if step.fix != nil {
            Button(model.tailscaleFixing == step.fix ? "Working…" : (step.fixLabel ?? "Fix")) {
              Task { await model.fixTailscale(step) }
            }
            .disabled(busy)
          }
        }
      }
      if model.tailscaleHandedOff {
        Text("Finish in the browser, then re-check.").font(.callout).foregroundStyle(theme.textSecondary)
      }
      if let error = model.tailscaleError {
        Text(error).font(.callout).foregroundStyle(theme.error).textSelection(.enabled)
      }
      HStack {
        Button(model.tailscaleChecking ? "Checking…" : "Re-check") {
          Task { await model.diagnoseTailscale() }
        }
        .disabled(busy)
        if model.tailscale?.ready == true {
          Text("Ready — enable remote access to start the Funnel.")
            .font(.callout).foregroundStyle(theme.success)
        }
      }
    }
    .task { if model.tailscale == nil { await model.diagnoseTailscale() } }
  }

  @ViewBuilder
  private func icon(_ step: ArgusProtocol.TailscaleStep) -> some View {
    if model.tailscaleFixing != nil, step.fix == model.tailscaleFixing {
      ProgressView().controlSize(.small)
    } else {
      switch step.state {
      case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.success)
      case .fail: Image(systemName: "xmark.circle.fill").foregroundStyle(theme.error)
      default: Image(systemName: "minus.circle").foregroundStyle(theme.textMuted)
      }
    }
  }
}
