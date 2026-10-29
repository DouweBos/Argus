import ArgusCore
import ArgusKit
import SwiftUI

/// The whole ticket the way Linear shows it: title, description, sub-issues,
/// relations, resources and one activity timeline, with its properties in a
/// sidebar when there's room — for the Mac's issue page and the phone's issue screen.
public struct LinearIssueDetailView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  let model: LinearIssueDetailModel
  /// Changing status or priority and commenting; false reads only.
  let canEdit: Bool
  /// False greys out "Start agent": no project picked, or no control.
  let canStart: Bool
  /// Where the issue sits in the caller's list; nil hides previous/next.
  let position: LinearIssueActivity.Position?
  let onOpenSession: (RemoteSession) -> Void
  let onStart: (HostStore.LinearIssue) -> Void
  /// Another issue by identifier: previous/next, a sub-issue or a relation.
  let onOpenIssue: ((String) -> Void)?
  /// Figma links, in the description, comments and links, open here instead of the browser.
  let onOpenDesign: ((String) -> Void)?
  @State private var width: CGFloat = 0

  public init(
    model: LinearIssueDetailModel, canEdit: Bool, canStart: Bool,
    position: LinearIssueActivity.Position? = nil,
    onOpenSession: @escaping (RemoteSession) -> Void,
    onStart: @escaping (HostStore.LinearIssue) -> Void,
    onOpenIssue: ((String) -> Void)? = nil,
    onOpenDesign: ((String) -> Void)? = nil
  ) {
    self.model = model
    self.canEdit = canEdit
    self.canStart = canStart
    self.position = position
    self.onOpenSession = onOpenSession
    self.onStart = onStart
    self.onOpenIssue = onOpenIssue
    self.onOpenDesign = onOpenDesign
  }

  /// Wide enough for the properties beside the content, like Linear.
  private var wide: Bool { width >= 820 }

  public var body: some View {
    Group {
      if let issue = model.issue {
        ScrollView {
          if wide {
            HStack(alignment: .top, spacing: 40) {
              main(issue).frame(maxWidth: 760, alignment: .leading)
              LinearIssueProperties(model: model, issue: issue, canEdit: canEdit)
                .frame(width: 240, alignment: .leading)
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 20)
            .frame(maxWidth: .infinity, alignment: .top)
          } else {
            main(issue).padding(theme.space + 4)
          }
        }
      } else if let error = model.loadError {
        EmptyState(icon: Icon.warning, title: "Couldn't load the issue", body: error, selectable: true)
      } else {
        Loading(label: "Asking Linear…")
      }
    }
    .onGeometryChange(for: CGFloat.self, of: \.size.width) { width = $0 }
    .task(id: model.ref) { await model.load() }
    .environment(\.openURL, OpenURLAction(handler: openLink))
  }

  private func main(_ issue: HostStore.LinearIssueDetail) -> some View {
    VStack(alignment: .leading, spacing: 20) {
      LinearIssueToolbar(issue: issue, position: position, onOpenIssue: onOpenIssue)
      header(issue)
      actions(issue)
      if let error = model.actionError { Banner(text: error, tone: .danger) }
      if !wide {
        LinearIssueProperties(model: model, issue: issue, canEdit: canEdit)
      }
      description(issue)
      if !issue.children.isEmpty { subIssues(issue) }
      if let relations = issue.relations, !relations.isEmpty { LinearIssueRelations(relations: relations, onOpen: onOpenIssue) }
      if !issue.attachments.isEmpty { LinearIssueResources(attachments: issue.attachments) }
      Divider().overlay(theme.borderSubtle)
      LinearIssueActivityView(model: model, issue: issue, canComment: canEdit)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func openLink(_ url: URL) -> OpenURLAction.Result {
    guard let onOpenDesign, FigmaLink.isDesign(url) else { return .systemAction }
    onOpenDesign(url.absoluteString)
    return .handled
  }

  private func header(_ issue: HostStore.LinearIssueDetail) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      if let parent = issue.parent {
        issueLink(parent.identifier) {
          MutedText("Sub-issue of \(parent.identifier) · \(parent.title)", lineLimit: 2)
        }
      }
      Text(issue.title)
        .font(.scaled(size: 22, weight: .semibold))
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
    }
  }

  @ViewBuilder private func description(_ issue: HostStore.LinearIssueDetail) -> some View {
    if issue.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      MutedText("No description.")
    } else {
      MarkdownView(text: issue.description, baseSize: 15)
    }
  }

  private func subIssues(_ issue: HostStore.LinearIssueDetail) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      SectionHeader(title: "Sub-issues", count: issue.children.count)
      ForEach(issue.children, id: \.identifier) { child in
        issueLink(child.identifier) {
          LinearIssueLine(identifier: child.identifier, title: child.title, stateType: child.state.type)
        }
        .accessibilityLabel("\(child.identifier), \(child.title), \(child.state.name)")
      }
    }
  }

  @ViewBuilder private func issueLink(_ identifier: String, @ViewBuilder label: () -> some View) -> some View {
    if let onOpenIssue {
      Button { onOpenIssue(identifier) } label: { label().contentShape(Rectangle()) }
        .buttonStyle(.argusPlain)
    } else {
      label()
    }
  }
}

/// One issue on a line: status, identifier, title.
struct LinearIssueLine: View {
  @Environment(\.theme) private var theme
  let identifier: String
  let title: String
  let stateType: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      IssueStatusGlyph(type: stateType, size: 12)
      Text(identifier)
        .font(.scaled(size: 12, design: .monospaced))
        .foregroundStyle(theme.textMuted)
      Text(title).font(.scaled(size: 13)).foregroundStyle(theme.text).lineLimit(1)
      Spacer(minLength: 0)
    }
    .accessibilityElement(children: .combine)
  }
}

/// Related issues, a group per kind of relation.
struct LinearIssueRelations: View {
  let relations: [ArgusProtocol.LinearIssueDetailRelationsItem]
  let onOpen: ((String) -> Void)?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(LinearIssueActivity.relationGroups(relations)) { group in
        VStack(alignment: .leading, spacing: 6) {
          SectionHeader(title: group.title, count: group.issues.count)
          ForEach(group.issues, id: \.identifier) { related in
            let line = LinearIssueLine(identifier: related.identifier, title: related.title, stateType: related.state.type)
            if let onOpen {
              Button { onOpen(related.identifier) } label: { line.contentShape(Rectangle()) }
                .buttonStyle(.argusPlain)
            } else {
              line
            }
          }
        }
      }
    }
  }
}

/// Pull requests, commits and links on the issue: Linear's Resources.
struct LinearIssueResources: View {
  @Environment(\.theme) private var theme
  let attachments: [ArgusProtocol.LinearAttachment]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      SectionHeader(title: "Resources", count: attachments.count)
      ForEach(attachments, id: \.url) { attachment in
        if let url = URL(string: attachment.url) {
          Link(destination: url) { row(attachment) }
            .clickable()
        }
      }
    }
  }

  private func row(_ attachment: ArgusProtocol.LinearAttachment) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Group {
        if attachment.sourceType == "github" {
          BrandIcon.github.resizable().scaledToFit().frame(width: 13, height: 13)
        } else {
          Image(systemName: Icon.link).font(.scaled(size: 12))
        }
      }
      .foregroundStyle(theme.textMuted)
      Text(attachment.title).font(.scaled(size: 13)).foregroundStyle(theme.text).lineLimit(1)
      if let subtitle = attachment.subtitle {
        Text(subtitle).font(.scaled(size: 12, design: .monospaced)).foregroundStyle(theme.textMuted).lineLimit(1)
      }
      Spacer(minLength: 8)
      if let at = attachment.createdAt {
        Text(Labels.timeAgo(at)).font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
      }
    }
    .padding(.vertical, 4)
    .contentShape(Rectangle())
  }
}
