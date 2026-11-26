import ArgusCore
import SwiftUI

extension LineAuthor {
  /// A dot for an agent, a bar for a person: told apart by shape as well as colour.
  public var glyph: String {
    switch self {
    case .agent: "\u{25CF}"
    case .human: "\u{258D}"
    }
  }

  public var label: String {
    switch self {
    case .agent: "Agent"
    case .human: "Human"
    }
  }

  public var accessibilityLabel: String {
    switch self {
    case .agent: "Written by an agent"
    case .human: "Edited by a person"
    }
  }

  public func color(_ theme: Theme) -> Color {
    switch self {
    case .agent: theme.attributionAgent
    case .human: theme.attributionHuman
    }
  }
}

/// One line's mark: a small dot or a thin bar, the height of the row.
public struct AttributionMark: View {
  @Environment(\.theme) private var theme
  let author: LineAuthor?
  var height: CGFloat

  public init(_ author: LineAuthor?, height: CGFloat = 14) {
    self.author = author
    self.height = height
  }

  public var body: some View {
    ZStack {
      switch author {
      case .agent?: Circle().fill(theme.attributionAgent).frame(width: 5, height: 5)
      case .human?: Capsule().fill(theme.attributionHuman).frame(width: 2.5, height: height)
      case nil: Color.clear
      }
    }
    .frame(width: 7, height: height)
    .accessibilityLabel(author?.accessibilityLabel ?? "")
    .accessibilityHidden(author == nil)
  }
}

/// What the gutter marks mean, with how many of the lines shown each author has.
public struct AttributionLegend: View {
  @Environment(\.theme) private var theme
  let counts: AttributionCounts?

  /// Nil counts shows the key alone.
  public init(counts: AttributionCounts? = nil) {
    self.counts = counts
  }

  public var body: some View {
    HStack(spacing: 10) {
      item(.agent, count: counts?.agent)
      item(.human, count: counts?.human)
    }
    .font(.scaled(size: 11))
    .foregroundStyle(theme.textSecondary)
    .fixedSize()
    .accessibilityElement(children: .combine)
  }

  private func item(_ author: LineAuthor, count: Int?) -> some View {
    HStack(spacing: 4) {
      AttributionMark(author, height: 10)
      Text(author.label)
      if let count {
        Text("\(count)").monospacedDigit().foregroundStyle(theme.textMuted)
      }
    }
  }
}
