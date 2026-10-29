import ArgusCore
import ArgusKit
import SwiftUI

/// One Linear issue as a person scans it to decide what's next: status and
/// priority, the title, what it's planned under, and whether an agent is on
/// it — Peacock's `IssueCard`.
public struct LinearIssueCard: View {
  public enum Style { case card, row }

  @Environment(\.theme) private var theme
  let issue: HostStore.LinearIssue
  let agentOnIt: Bool
  let selected: Bool
  let style: Style

  public init(issue: HostStore.LinearIssue, agentOnIt: Bool, selected: Bool = false, style: Style = .card) {
    self.issue = issue
    self.agentOnIt = agentOnIt
    self.selected = selected
    self.style = style
  }

  public var body: some View {
    let content = VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        Text(issue.parent.map { "\($0.identifier) › \(issue.identifier)" } ?? issue.identifier)
          .font(.scaled(size: 11, design: .monospaced))
          .foregroundStyle(theme.textMuted)
          .lineLimit(1)
        Spacer(minLength: 4)
        if let assignee = issue.assignee {
          LinearAvatar(name: assignee, url: issue.assigneeAvatarUrl, size: 18)
        }
      }
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        IssueStatusGlyph(type: issue.state.type, color: issue.state.color)
          .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
        Text(issue.title)
          .font(.scaled(size: 13, weight: .medium))
          .foregroundStyle(theme.text)
          .lineLimit(3)
          .multilineTextAlignment(.leading)
          .fixedSize(horizontal: false, vertical: true)
      }
      ChipFlowLayout(spacing: 4, lineSpacing: 4) {
        chip { PriorityGlyph(priority: issue.priority, size: 12) }
        if let estimate = issue.estimate {
          chip(LinearIssueBoard.estimateLabel(estimate, type: issue.estimateType, unit: false), icon: "triangle")
            .help("Estimate \(LinearIssueBoard.estimateLabel(estimate, type: issue.estimateType))")
        }
        if let cycle = issue.cycle {
          chip(LinearIssueBoard.cycleShortLabel(number: cycle.number, name: cycle.name), icon: "arrow.triangle.2.circlepath")
            .help(LinearIssueBoard.cycleLabel(number: cycle.number, name: cycle.name))
        }
        if let project = issue.project { chip(project.name) }
        if issue.pullRequestCount > 0 {
          let count = Int(issue.pullRequestCount)
          chip("\(count) PR\(count == 1 ? "" : "s")")
        }
        ForEach(issue.labels, id: \.self) { label in
          chip {
            Circle().fill(Color(linearHex: labelColor(label)) ?? theme.textMuted).frame(width: 7, height: 7)
            Text(label).lineLimit(1)
          }
        }
        if agentOnIt { Badge(label: "Agent on it", tone: .accent) }
      }
      Text("Created \(LinearIssueBoard.date(issue.createdAt).formatted(.dateTime.month(.abbreviated).year()))")
        .font(.scaled(size: 11))
        .foregroundStyle(theme.textMuted)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)

    switch style {
    case .row:
      content.padding(.vertical, 4)
    case .card:
      content
        .padding(10)
        .background(selected ? theme.selection : theme.bgSecondary)
        .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
        .overlay(
          RoundedRectangle(cornerRadius: theme.radiusSmall)
            .stroke(selected ? theme.accentBorder : theme.border, lineWidth: 1))
    }
  }

  private func labelColor(_ name: String) -> String? {
    issue.labelColors?.first { $0.name == name }?.color
  }

  private func chip(_ text: String, icon: String? = nil) -> some View {
    chip {
      if let icon { Image(systemName: icon).font(.scaled(size: 9, weight: .semibold)) }
      Text(text).lineLimit(1)
    }
  }

  private func chip(@ViewBuilder _ content: () -> some View) -> some View {
    HStack(spacing: 4) { content() }
      .font(.scaled(size: 11))
      .foregroundStyle(theme.textSecondary)
      .padding(.horizontal, 6)
      .frame(minHeight: 18)
      .overlay(Capsule().stroke(theme.border, lineWidth: 1))
  }
}

/// A Linear user's picture, or their initials.
public struct LinearAvatar: View {
  let name: String
  let url: String?
  let size: CGFloat

  public init(name: String, url: String?, size: CGFloat) {
    self.name = name
    self.url = url
    self.size = size
  }

  public var body: some View {
    let words = name.split(separator: " ").map(String.init)
    AccountAvatar(
      profile: AccountProfile(
        firstName: words.first, lastName: words.count > 1 ? words.last : nil,
        imageURL: url.flatMap(URL.init(string:))),
      size: size
    )
    .help(name)
  }
}
