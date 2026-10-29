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

/// Linear's Properties in the context card's surface: what to do with the
/// issue on top, then status and priority as menus when you may change them
/// (S and P open them on the Mac), then the rest, each with who last changed
/// it on hover.
struct LinearIssueProperties<Actions: View>: View {
  @Environment(\.theme) private var theme
  let model: LinearIssueDetailModel
  let issue: HostStore.LinearIssueDetail
  let canEdit: Bool
  /// A status or priority menu opened; true when by its page key.
  var onMenuOpened: ((LinearIssueProperty.Kind, Bool) -> Void)?
  @ViewBuilder var actions: () -> Actions
  @State private var open: LinearIssueProperty.Kind?

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if Actions.self != EmptyView.self {
        actions()
        ContextCardDivider()
      }
      status
      priority
      changed(.assignee) {
        if let assignee = issue.assignee {
          LinearAvatar(name: assignee, url: issue.assigneeAvatarUrl, size: 14).frame(width: 16)
          value(assignee)
        } else {
          icon(Icon.person)
          muted("Unassigned")
        }
      }
      row {
        icon("square.stack")
        value(issue.teamName)
      }
      if let estimate = issue.estimate {
        changed(.estimate) {
          icon("triangle")
          value(LinearIssueBoard.estimateLabel(estimate, type: issue.estimateType))
        }
        .accessibilityLabel("Estimate \(LinearIssueBoard.estimateLabel(estimate, type: issue.estimateType))")
      }
      if let cycle = issue.cycle {
        changed(.cycle) {
          icon("arrow.triangle.2.circlepath")
          value(LinearIssueBoard.cycleLabel(number: cycle.number, name: cycle.name))
          if cycle.isActive { muted("current") }
        }
      }
      if let due = issue.dueDate {
        row {
          icon("calendar")
          value("Due \(due)")
        }
      }
      ContextCardDivider()
      changed(.project) {
        icon("cube")
        if let project = issue.project { value(project.name) } else { muted("No project") }
      }
      if issue.labels.isEmpty {
        row {
          icon("tag")
          muted("No labels")
        }
      } else {
        ChipFlowLayout(spacing: 4, lineSpacing: 4) {
          ForEach(issue.labels, id: \.self) { LinearLabelChip(name: $0, hex: color(of: $0)) }
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
      }
    }
    .padding(ContextCardMetrics.padding)
    .floatingSurface()
    #if os(macOS)
      .pageKeys(enabled: canEdit && open == nil) { typed in
        switch typed {
        case "s": show(.status)
        case "p": show(.priority)
        default: return false
        }
        return true
      }
    #endif
  }

  private func show(_ kind: LinearIssueProperty.Kind, byKey: Bool = true) {
    open = kind
    onMenuOpened?(kind, byKey)
  }

  private func isOpen(_ kind: LinearIssueProperty.Kind) -> Binding<Bool> {
    Binding(
      get: { open == kind },
      set: { shown in
        if shown { show(kind, byKey: false) } else if open == kind { open = nil }
      })
  }

  private var status: some View {
    Group {
      if canEdit {
        LinearPropertyPill(
          options: LinearIssueProperty.statusOptions(model.stateOptions), current: issue.state.id,
          placeholder: "Change status…", key: "S", isOpen: isOpen(.status),
          icon: { id in
            let state = model.stateOptions.first { $0.id == id }
            return AnyView(IssueStatusGlyph(type: state?.type ?? "", color: state?.color))
          },
          pick: { id in Task { await model.setState(id) } }
        ) {
          IssueStatusGlyph(type: issue.state.type, color: issue.state.color).frame(width: 16)
          value(issue.state.name)
        }
        .disabled(model.updating)
      } else {
        row {
          IssueStatusGlyph(type: issue.state.type, color: issue.state.color).frame(width: 16)
          value(issue.state.name)
        }
      }
    }
    .propertyHoverCard(enabled: open == nil) { LinearTimeInStatusCard(issue: issue, states: model.stateOptions, canEdit: canEdit) }
    .accessibilityLabel("Status \(issue.state.name)")
  }

  private var priority: some View {
    let label = LinearIssueBoard.priorityLabel(Int(issue.priority))
    return Group {
      if canEdit {
        LinearPropertyPill(
          options: LinearIssueProperty.priorityOptions, current: "\(Int(issue.priority))",
          placeholder: "Change priority…", key: "P", isOpen: isOpen(.priority),
          icon: { id in AnyView(PriorityGlyph(priority: Int(id) ?? 0)) },
          pick: { id in if let priority = Int(id) { Task { await model.setPriority(priority) } } }
        ) {
          PriorityGlyph(priority: issue.priority).frame(width: 16)
          value(label)
        }
        .disabled(model.updating)
      } else {
        row {
          PriorityGlyph(priority: issue.priority).frame(width: 16)
          value(label)
        }
      }
    }
    .propertyHoverCard(enabled: open == nil) { LinearLastChangeCard(kind: .priority, history: issue.history) }
    .accessibilityLabel("Priority \(label)")
  }

  /// A read-only row that tells, on hover, who last changed it.
  private func changed(_ kind: LinearIssueProperty.Kind, @ViewBuilder content: () -> some View) -> some View {
    row(content: content)
      .propertyHoverCard { LinearLastChangeCard(kind: kind, history: issue.history) }
  }

  private func color(of label: String) -> String? {
    issue.labelColors?.first { $0.name == label }?.color
  }

  /// A context card row: the same inset and height, so menus and facts line up.
  private func row(@ViewBuilder content: () -> some View) -> some View {
    HStack(spacing: 8) {
      content()
      Spacer(minLength: 4)
    }
    .padding(.horizontal, 7)
    .frame(minHeight: TextScale.shared(26))
    .contentShape(.rect)
    .accessibilityElement(children: .combine)
  }

  private func icon(_ name: String) -> some View {
    Image(systemName: name).font(.scaled(size: 12)).foregroundStyle(theme.textMuted).frame(width: 16)
  }

  private func value(_ text: String) -> some View {
    Text(text).font(.scaled(size: 12)).foregroundStyle(theme.text).lineLimit(1).truncationMode(.middle)
  }

  private func muted(_ text: String) -> some View {
    Text(text).font(.scaled(size: 12)).foregroundStyle(theme.textMuted).lineLimit(1)
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

  private var swatch: Color { Color(linearHex: hex) ?? theme.textMuted }
}

extension LinearIssueProperties where Actions == EmptyView {
  init(
    model: LinearIssueDetailModel, issue: HostStore.LinearIssueDetail, canEdit: Bool,
    onMenuOpened: ((LinearIssueProperty.Kind, Bool) -> Void)? = nil
  ) {
    self.init(model: model, issue: issue, canEdit: canEdit, onMenuOpened: onMenuOpened) { EmptyView() }
  }
}
