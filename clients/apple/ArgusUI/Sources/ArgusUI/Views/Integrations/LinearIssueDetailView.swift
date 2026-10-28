import ArgusCore
import ArgusKit
import SwiftUI

/// The whole ticket: what to do next, its properties (status and priority
/// changeable), description, sub-issues, links and comments — the desktop's
/// issue detail, for the Mac's inspector and the phone's issue screen.
public struct LinearIssueDetailView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  let model: LinearIssueDetailModel
  /// Changing status or priority and commenting; false reads only.
  let canEdit: Bool
  /// False greys out "Start agent": no project picked, or no control.
  let canStart: Bool
  let onOpenSession: (RemoteSession) -> Void
  let onStart: (HostStore.LinearIssue) -> Void

  public init(
    model: LinearIssueDetailModel, canEdit: Bool, canStart: Bool,
    onOpenSession: @escaping (RemoteSession) -> Void,
    onStart: @escaping (HostStore.LinearIssue) -> Void
  ) {
    self.model = model
    self.canEdit = canEdit
    self.canStart = canStart
    self.onOpenSession = onOpenSession
    self.onStart = onStart
  }

  public var body: some View {
    Group {
      if let issue = model.issue {
        ScrollView {
          VStack(alignment: .leading, spacing: 18) {
            header(issue)
            actions(issue)
            if let error = model.actionError { Banner(text: error, tone: .danger) }
            LinearIssueProperties(model: model, issue: issue, canEdit: canEdit)
            description(issue)
            if !issue.children.isEmpty { subIssues(issue) }
            if !issue.attachments.isEmpty { links(issue) }
            LinearIssueComments(model: model, issue: issue, canComment: canEdit)
          }
          .padding(theme.space + 4)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      } else if let error = model.loadError {
        EmptyState(icon: Icon.warning, title: "Couldn't load the issue", body: error, selectable: true)
      } else {
        Loading(label: "Asking Linear…")
      }
    }
    .task(id: model.ref) { await model.load() }
  }

  private func header(_ issue: HostStore.LinearIssueDetail) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      if let parent = issue.parent {
        MutedText("Sub-issue of \(parent.identifier) · \(parent.title)", lineLimit: 2)
      }
      Text(issue.identifier)
        .font(.scaled(size: 12, design: .monospaced))
        .foregroundStyle(theme.textMuted)
        .textSelection(.enabled)
      Text(issue.title)
        .font(.scaled(size: 18, weight: .semibold))
        .foregroundStyle(theme.text)
        .textSelection(.enabled)
    }
  }

  private func actions(_ issue: HostStore.LinearIssueDetail) -> some View {
    let summary = HostStore.LinearIssue(issue)
    return HStack(spacing: 8) {
      if let session = host.session(workingOn: summary) {
        Btn(label: "Open session", small: true, icon: Icon.agent, hugs: true) { onOpenSession(session) }
      } else {
        Btn(label: "Start agent", small: true, icon: Icon.play, hugs: true) { onStart(summary) }
          .disabled(!canStart)
      }
      if let url = URL(string: issue.url) {
        Link(destination: url) {
          Label("Open in Linear", systemImage: Icon.openExternal)
            .font(.scaled(size: 13, weight: .semibold))
            .foregroundStyle(theme.textSecondary)
        }
        .clickable()
      }
    }
  }

  @ViewBuilder private func description(_ issue: HostStore.LinearIssueDetail) -> some View {
    if issue.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      MutedText("No description.")
    } else {
      MarkdownView(text: issue.description, baseSize: 14)
    }
  }

  private func subIssues(_ issue: HostStore.LinearIssueDetail) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionHeader(title: "Sub-issues", count: issue.children.count)
      ForEach(issue.children, id: \.identifier) { child in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          IssueStatusGlyph(type: child.state.type, size: 12)
          Text(child.identifier)
            .font(.scaled(size: 12, design: .monospaced))
            .foregroundStyle(theme.textMuted)
          BodyText(child.title, lineLimit: 2)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(child.identifier), \(child.title), \(child.state.name)")
      }
    }
  }

  private func links(_ issue: HostStore.LinearIssueDetail) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      SectionHeader(title: "Links", count: issue.attachments.count)
      ForEach(issue.attachments, id: \.url) { attachment in
        if let url = URL(string: attachment.url) {
          Link(destination: url) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
              Image(systemName: Icon.link).foregroundStyle(theme.textMuted)
              Text(attachment.title).foregroundStyle(theme.text).lineLimit(1)
              if let subtitle = attachment.subtitle {
                Text(subtitle).foregroundStyle(theme.textMuted).lineLimit(1)
              }
            }
            .font(.scaled(size: 13))
          }
          .clickable()
        }
      }
    }
  }
}

/// Status and priority as pickers when you may change them, the rest at a glance.
struct LinearIssueProperties: View {
  @Environment(\.theme) private var theme
  let model: LinearIssueDetailModel
  let issue: HostStore.LinearIssueDetail
  let canEdit: Bool

  var body: some View {
    Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
      row("Status") {
        HStack(spacing: 6) {
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
      row("Priority") {
        HStack(spacing: 6) {
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
      row("Assignee") {
        if let assignee = issue.assignee {
          HStack(spacing: 6) {
            LinearAvatar(name: assignee, url: issue.assigneeAvatarUrl, size: 18)
            value(assignee)
          }
        } else {
          MutedText("Unassigned")
        }
      }
      row("Team") { value(issue.teamName) }
      if let project = issue.project { row("Project") { value(project.name) } }
      if let cycle = issue.cycle {
        row("Cycle") {
          value(LinearIssueBoard.cycleLabel(number: cycle.number, name: cycle.name) + (cycle.isActive ? " · current" : ""))
        }
      }
      if let estimate = issue.estimate { row("Estimate") { value(LinearIssueBoard.estimateLabel(estimate)) } }
      if !issue.labels.isEmpty {
        row("Labels") {
          ChipFlowLayout(spacing: 4, lineSpacing: 4) { ForEach(issue.labels, id: \.self) { Badge(label: $0) } }
        }
      }
      row("Branch") {
        Text(issue.branchName)
          .font(.scaled(size: 12, design: .monospaced))
          .foregroundStyle(theme.text)
          .textSelection(.enabled)
          .lineLimit(2)
      }
      row("Created") { value(Self.format(issue.createdAt)) }
      row("Updated") { value(Self.format(issue.updatedAt)) }
    }
  }

  private var stateSelection: Binding<String> {
    Binding(get: { issue.state.id }, set: { id in Task { await model.setState(id) } })
  }

  private var prioritySelection: Binding<Int> {
    Binding(get: { Int(issue.priority) }, set: { p in Task { await model.setPriority(p) } })
  }

  private func row(_ label: String, @ViewBuilder content: () -> some View) -> some View {
    GridRow {
      Text(label)
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textMuted)
        .gridColumnAlignment(.leading)
      content()
    }
  }

  private func value(_ text: String) -> some View {
    Text(text).font(.scaled(size: 13)).foregroundStyle(theme.text).lineLimit(2)
  }

  static func format(_ epochMs: Double) -> String {
    LinearIssueBoard.date(epochMs).formatted(.dateTime.month(.abbreviated).day().year())
  }
}

/// The thread, oldest first, with a box to add to it as the computer's Linear user.
struct LinearIssueComments: View {
  @Environment(\.theme) private var theme
  let model: LinearIssueDetailModel
  let issue: HostStore.LinearIssueDetail
  let canComment: Bool
  @State private var draft = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      SectionHeader(title: "Comments", count: issue.comments.count)
      ForEach(Array(issue.comments.enumerated()), id: \.offset) { _, comment in
        VStack(alignment: .leading, spacing: 4) {
          HStack(spacing: 6) {
            Text(comment.author ?? "Someone")
              .font(.scaled(size: 12, weight: .semibold))
              .foregroundStyle(theme.text)
            Text(LinearIssueProperties.format(comment.createdAt))
              .font(.scaled(size: 12))
              .foregroundStyle(theme.textMuted)
          }
          MarkdownView(text: comment.body, baseSize: 13)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
      }
      if canComment {
        ThemedTextField(placeholder: "Leave a comment…", text: $draft, multiline: true, lines: 3...8)
        HStack {
          Spacer()
          Btn(label: model.posting ? "Posting…" : "Comment", small: true, hugs: true) {
            Task { if await model.comment(draft) { draft = "" } }
          }
          .disabled(model.posting || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          .keyboardShortcut(.return, modifiers: .command)
        }
      }
    }
  }
}
