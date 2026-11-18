import ArgusUI
import SwiftUI

/// The symbols the blueprint screens share.
enum BlueprintSymbol {
  static let blueprint = Icon.blueprint
  static let newProject = "folder.badge.plus"
}

/// One blueprint in a list: what it makes and how many projects it copies from.
struct BlueprintRow: View {
  @Environment(\.theme) private var theme
  let blueprint: BlueprintsStore.Blueprint

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: BlueprintSymbol.blueprint)
        .font(.scaled(size: 17))
        .foregroundStyle(theme.accent)
        .frame(width: 24)
      VStack(alignment: .leading, spacing: 2) {
        Text(blueprint.name).lineLimit(1)
        if !blueprint.summary.isEmpty {
          Text(blueprint.summary)
            .font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(2)
        }
        Text(meta)
          .font(.scaled(.caption)).foregroundStyle(theme.textMuted).lineLimit(1)
      }
    }
  }

  private var meta: String {
    let count = blueprint.references.count
    let references = count == 0 ? "No references" : AutomationText.plural(count, "reference")
    return "\(references) · \(blueprint.scaffoldLabel)"
  }
}

/// A project made from a blueprint, for the run history.
struct BlueprintRunRow: View {
  let run: BlueprintsStore.Run

  var body: some View {
    HStack(spacing: 10) {
      VStack(alignment: .leading, spacing: 3) {
        Text(run.projectName).lineLimit(1)
        Text(Labels.timeAgo(run.startedAt))
          .font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer(minLength: 6)
      Badge(label: Self.label(run.status), tone: Self.tone(run.status))
    }
  }

  static func label(_ status: ArgusProtocol.BlueprintRunStatus) -> String {
    switch status {
    case .running: "Running"
    case .failed: "Failed"
    case .done: "Done"
    default: status.rawValue.capitalized
    }
  }

  static func tone(_ status: ArgusProtocol.BlueprintRunStatus) -> Tone {
    switch status {
    case .running: .accent
    case .failed: .danger
    case .done: .success
    default: .muted
    }
  }
}

/// The four steps a new project goes through, each with its state; a failed
/// step carries the host's reason underneath.
struct BlueprintRunSteps: View {
  @Environment(\.theme) private var theme
  let run: BlueprintsStore.Run

  var body: some View {
    Card {
      ForEach(Array(run.steps.enumerated()), id: \.offset) { index, step in
        if index > 0 { Divider() }
        HStack(alignment: .top, spacing: 10) {
          indicator(step.status).frame(width: 20, height: 22)
          VStack(alignment: .leading, spacing: 3) {
            Text(step.key.label)
              .font(.scaled(size: 15))
              .foregroundStyle(step.status == .pending ? theme.textMuted : theme.text)
            if let error = step.error, !error.isEmpty {
              Text(error)
                .font(.scaled(.footnote)).foregroundStyle(theme.error)
                .textSelection(.enabled)
            }
          }
          Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
      }
    }
  }

  @ViewBuilder
  private func indicator(_ status: ArgusProtocol.BlueprintStepStatus) -> some View {
    switch status {
    case .running: ProgressView().controlSize(.small)
    case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.success)
    case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(theme.error)
    default: Image(systemName: "circle").foregroundStyle(theme.textMuted)
    }
  }
}

extension View {
  /// Sends `ios_blueprint_opened` once per screen, not again on the way back to it.
  func reportsBlueprintScreen(_ screen: TelemetryEvent.BlueprintScreen) -> some View {
    modifier(BlueprintScreenReport(screen: screen))
  }
}

private struct BlueprintScreenReport: ViewModifier {
  let screen: TelemetryEvent.BlueprintScreen
  @State private var sent = false

  func body(content: Content) -> some View {
    content.onAppear {
      guard !sent else { return }
      sent = true
      Telemetry.capture(.blueprintOpened(screen: screen))
    }
  }
}
