import SwiftUI

/// Grove's card treatment: content on a raised, rounded surface over `theme.bg`.
private struct CardSurface: ViewModifier {
  @Environment(\.theme) private var theme
  let padding: CGFloat?

  func body(content: Content) -> some View {
    let shape = RoundedRectangle(cornerRadius: theme.radius, style: .continuous)
    content
      .padding(padding ?? 0)
      .background(theme.bgSecondary, in: shape)
      .clipShape(shape)
      .overlay(shape.strokeBorder(theme.border, lineWidth: 0.5))
  }
}

extension View {
  /// A padded card, for forms and summaries.
  public func card(padding: CGFloat = 12) -> some View {
    modifier(CardSurface(padding: padding))
  }

  /// A card without padding, for lists and diffs that run to its edges.
  public func panel() -> some View {
    modifier(CardSurface(padding: nil))
  }
}

/// The title row at the top of a `panel()`: title, optional mono detail, trailing controls.
public struct PanelHeader<Accessory: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  var detail: String?
  let accessory: Accessory

  public init(title: String, detail: String? = nil, @ViewBuilder accessory: () -> Accessory) {
    self.title = title
    self.detail = detail
    self.accessory = accessory()
  }

  public var body: some View {
    HStack(spacing: 8) {
      Text(title)
        .font(.scaled(size: 13, weight: .semibold))
        .foregroundStyle(theme.text)
        .lineLimit(1)
      if let detail {
        Text(detail)
          .font(.scaled(size: 11, design: .monospaced))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
      }
      Spacer(minLength: 8)
      accessory
    }
    .padding(.horizontal, 14)
    .frame(height: 40)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.border).frame(height: 0.5) }
  }
}

extension PanelHeader where Accessory == EmptyView {
  public init(title: String, detail: String? = nil) {
    self.init(title: title, detail: detail) { EmptyView() }
  }
}

/// A sidebar section's title with its count in a capsule, as Grove's "Branches 3".
public struct SectionLabel: View {
  @Environment(\.theme) private var theme
  let title: String
  var count: Int?

  public init(_ title: String, count: Int? = nil) {
    self.title = title
    self.count = count
  }

  public var body: some View {
    HStack(spacing: 4) {
      Text(title)
      if let count {
        Text(count, format: .number)
          .font(.scaled(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(theme.textSecondary)
          .padding(.horizontal, 6)
          .padding(.vertical, 1)
          .background(theme.bgTertiary, in: Capsule())
      }
    }
  }
}

#Preview {
  VStack(spacing: 12) {
    VStack(alignment: .leading, spacing: 6) {
      Text("Summary")
      Text("Description")
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .card()
    VStack(spacing: 0) {
      PanelHeader(title: "Files", detail: "3 changed") {
        Image(systemName: "list.bullet")
      }
      Spacer()
    }
    .panel()
    SectionLabel("Branches", count: 12)
  }
  .frame(width: 360, height: 320)
  .padding()
}
