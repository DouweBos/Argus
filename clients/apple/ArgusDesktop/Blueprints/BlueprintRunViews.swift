import ArgusCore
import ArgusUI
import SwiftUI

/// A project made from a blueprint, in its run history: name, status, when,
/// and the failing step's error. A finished one opens its session.
struct BlueprintRunRow: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let run: ArgusProtocol.BlueprintRun

  var body: some View {
    HStack(spacing: 10) {
      ZStack(alignment: .leading) {
        // As wide as the widest status, so the names line up.
        ForEach(["Creating", "Created", "Failed"], id: \.self) { Badge(label: $0).hidden() }
        Badge(label: BlueprintText.label(run.status), tone: BlueprintText.tone(run.status))
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(run.projectName).fontWeight(.medium)
        if let failed = run.failedStep {
          Text("\(failed.key.label): \(failed.error ?? "failed")")
            .font(.scaled(.caption)).foregroundStyle(theme.error).lineLimit(2)
        } else {
          Text(run.repoUrl ?? HostScopedPath.path(run.repoRoot))
            .font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      Text(Labels.timeAgo(run.startedAt)).foregroundStyle(.secondary).help(AutomationText.timestamp(run.startedAt))
      if run.sessionId != nil {
        Button("Open") { BlueprintActions.open(model, run: run) }
      }
    }
  }
}

/// The four steps of making a project, live: spinner, check or cross, and the
/// error under the step that failed.
struct BlueprintStepList: View {
  @Environment(\.theme) private var theme
  let steps: [ArgusProtocol.BlueprintStep]

  var body: some View {
    ForEach(steps, id: \.key) { step in
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        icon(step.status).frame(width: 16)
        VStack(alignment: .leading, spacing: 2) {
          Text(step.key.label)
            .foregroundStyle(step.status == .pending ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
          if let error = step.error, !error.isEmpty {
            Text(error).font(.scaled(.caption)).foregroundStyle(theme.error).textSelection(.enabled)
          }
        }
        Spacer(minLength: 0)
      }
    }
  }

  @ViewBuilder
  private func icon(_ status: ArgusProtocol.BlueprintStepStatus) -> some View {
    switch status {
    case .running: ProgressView().controlSize(.small)
    case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.success)
    case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(theme.error)
    default: Image(systemName: "circle").foregroundStyle(.tertiary)
    }
  }
}
