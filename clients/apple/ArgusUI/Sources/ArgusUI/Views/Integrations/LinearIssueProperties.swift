import ArgusCore
import ArgusKit
import SwiftUI

/// The issue's identifier, its place in the caller's list with previous/next,
/// and Linear's copy link / ID / branch and open buttons.
struct LinearIssueToolbar: View {
  @Environment(\.theme) private var theme
  let issue: HostStore.LinearIssueDetail
  let position: LinearIssueActivity.Position?
  let onOpenIssue: ((String) -> Void)?
  @State private var copied: String?

  var body: some View {
    HStack(spacing: 2) {
      Text(issue.identifier)
        .font(.scaled(size: 12, design: .monospaced))
        .foregroundStyle(theme.textMuted)
        .textSelection(.enabled)
      if let copied {
        Text(copied).font(.scaled(size: 12)).foregroundStyle(theme.textMuted).padding(.leading, 8)
      }
      Spacer(minLength: 8)
      if let position, let onOpenIssue { stepper(position, onOpenIssue) }
      copyButton(Icon.link, "Copy link", value: issue.url, done: "Link copied")
      copyButton("number", "Copy ID", value: issue.identifier, done: "ID copied")
      copyButton(Icon.branch, "Copy branch name", value: issue.branchName, done: "Branch copied")
      if let url = URL(string: issue.url) {
        Link(destination: url) {
          Image(systemName: Icon.openExternal)
            .font(.scaled(size: 13, weight: .medium))
            .foregroundStyle(theme.textSecondary)
            .frame(width: 28, height: 28)
            .contentShape(Rectangle())
        }
        .clickable()
        .help("Open in Linear")
        .accessibilityLabel("Open in Linear")
      }
    }
  }

  private func stepper(_ position: LinearIssueActivity.Position, _ open: @escaping (String) -> Void) -> some View {
    HStack(spacing: 0) {
      Text("\(position.index + 1) / \(position.total)")
        .font(.scaled(size: 12).monospacedDigit())
        .foregroundStyle(theme.textMuted)
        .padding(.trailing, 4)
      stepButton(Icon.chevronDown, "Next issue", to: position.next, open)
      stepButton(Icon.chevronUp, "Previous issue", to: position.previous, open)
    }
    .padding(.trailing, 8)
  }

  private func stepButton(
    _ icon: String, _ label: String, to identifier: String?, _ open: @escaping (String) -> Void
  ) -> some View {
    Button {
      if let identifier { open(identifier) }
    } label: {
      Image(systemName: icon)
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(theme.textSecondary)
        .frame(width: 26, height: 26)
        .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .disabled(identifier == nil)
    .opacity(identifier == nil ? 0.35 : 1)
    .help(label)
    .accessibilityLabel(label)
  }

  private func copyButton(_ icon: String, _ label: String, value: String, done: String) -> some View {
    Button {
      Clipboard.copy(value)
      copied = done
      Task {
        try? await Task.sleep(for: .seconds(2))
        if copied == done { copied = nil }
      }
    } label: {
      Image(systemName: icon)
        .font(.scaled(size: 13, weight: .medium))
        .foregroundStyle(theme.textSecondary)
        .frame(width: 28, height: 28)
        .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .help(label)
    .accessibilityLabel(label)
  }
}

/// Linear's Properties: status and priority as pickers when you may change
/// them, then assignee, team, estimate, cycle, labels and project.
struct LinearIssueProperties: View {
  @Environment(\.theme) private var theme
  let model: LinearIssueDetailModel
  let issue: HostStore.LinearIssueDetail
  let canEdit: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      group("Properties") {
        status
        priority
        row {
          if let assignee = issue.assignee {
            LinearAvatar(name: assignee, url: issue.assigneeAvatarUrl, size: 16)
            value(assignee)
          } else {
            Image(systemName: Icon.person).foregroundStyle(theme.textMuted)
            muted("Unassigned")
          }
        }
        row {
          Image(systemName: "square.stack").foregroundStyle(theme.textMuted)
          value(issue.teamName)
        }
        if let estimate = issue.estimate {
          row {
            Image(systemName: "triangle").foregroundStyle(theme.textMuted)
            value(LinearIssueBoard.estimateLabel(estimate, type: issue.estimateType))
          }
          .accessibilityLabel("Estimate \(LinearIssueBoard.estimateLabel(estimate, type: issue.estimateType))")
        }
        if let cycle = issue.cycle {
          row {
            Image(systemName: "arrow.triangle.2.circlepath").foregroundStyle(theme.textMuted)
            value(LinearIssueBoard.cycleLabel(number: cycle.number, name: cycle.name) + (cycle.isActive ? " · current" : ""))
          }
        }
        if let due = issue.dueDate {
          row {
            Image(systemName: "calendar").foregroundStyle(theme.textMuted)
            value("Due \(due)")
          }
        }
      }
      group("Labels") {
        if issue.labels.isEmpty {
          muted("No labels")
        } else {
          ChipFlowLayout(spacing: 6, lineSpacing: 6) {
            ForEach(issue.labels, id: \.self) { LinearLabelChip(name: $0, hex: color(of: $0)) }
          }
        }
      }
      group("Project") {
        row {
          Image(systemName: "cube").foregroundStyle(theme.textMuted)
          if let project = issue.project { value(project.name) } else { muted("No project") }
        }
      }
    }
    .font(.scaled(size: 12))
  }

  private var status: some View {
    row {
      IssueStatusGlyph(type: issue.state.type)
      if canEdit {
        Picker("Status", selection: stateSelection) {
          ForEach(model.stateOptions) { Text($0.name).tag($0.id) }
        }
        .labelsHidden()
        .fixedSize()
        .disabled(model.updating)
        .clickable()
      } else {
        value(issue.state.name)
      }
    }
  }

  private var priority: some View {
    row {
      PriorityGlyph(priority: issue.priority)
      if canEdit {
        Picker("Priority", selection: prioritySelection) {
          ForEach(LinearIssueBoard.priorityOrder, id: \.self) {
            Text(LinearIssueBoard.priorityLabel($0)).tag($0)
          }
        }
        .labelsHidden()
        .fixedSize()
        .disabled(model.updating)
        .clickable()
      } else {
        value(LinearIssueBoard.priorityLabel(Int(issue.priority)))
      }
    }
  }

  private func color(of label: String) -> String? {
    issue.labelColors?.first { $0.name == label }?.color
  }

  private var stateSelection: Binding<String> {
    Binding(get: { issue.state.id }, set: { id in Task { await model.setState(id) } })
  }

  private var prioritySelection: Binding<Int> {
    Binding(get: { Int(issue.priority) }, set: { p in Task { await model.setPriority(p) } })
  }

  private func group(_ title: String, @ViewBuilder content: () -> some View) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(title).font(.scaled(size: 12, weight: .medium)).foregroundStyle(theme.textMuted)
      content()
    }
  }

  private func row(@ViewBuilder content: () -> some View) -> some View {
    HStack(spacing: 8) { content() }
      .frame(minHeight: 22)
      .accessibilityElement(children: .combine)
  }

  private func value(_ text: String) -> some View {
    Text(text).font(.scaled(size: 13)).foregroundStyle(theme.text).lineLimit(2)
  }

  private func muted(_ text: String) -> some View {
    Text(text).font(.scaled(size: 13)).foregroundStyle(theme.textMuted)
  }
}

/// A label as Linear draws it: a pill with the label's own colour as a dot.
/// The colour is the label's data, so it's only ever the swatch.
struct LinearLabelChip: View {
  @Environment(\.theme) private var theme
  let name: String
  let hex: String?

  var body: some View {
    HStack(spacing: 6) {
      Circle().fill(swatch).frame(width: 8, height: 8)
      Text(name).font(.scaled(size: 12, weight: .medium)).foregroundStyle(theme.text).lineLimit(1)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 3)
    .overlay(Capsule().stroke(theme.border, lineWidth: 1))
    .accessibilityElement(children: .combine)
  }

  private var swatch: Color {
    guard let rgba = hex.flatMap(Inspection.RGBA.init(hex:)) else { return theme.textMuted }
    return Color(.sRGB, red: rgba.red, green: rgba.green, blue: rgba.blue, opacity: rgba.alpha)
  }
}
