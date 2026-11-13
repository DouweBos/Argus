import ArgusCore
import ArgusUI
import SwiftUI

/// The diff header's "Viewed" box, with "Changed" while a viewed file has moved on.
struct ViewedCheckbox: View {
  let viewed: ViewedFiles
  let path: String
  /// Ticking it moves on to the next file left to review.
  var advance: (() -> Void)?

  var body: some View {
    HStack(spacing: 6) {
      if viewed.state(path) == .changed { Badge(label: "Changed", tone: .warning) }
      Toggle(isOn: Binding(get: { viewed.isViewed(path) }, set: { set($0) })) { Text("Viewed") }
        .toggleStyle(.quietCheckbox)
        .help(viewed.state(path) == .changed ? "Changed since you viewed it" : "Mark as viewed")
        .fixedSize()
    }
  }

  private func set(_ on: Bool) {
    Task { await viewed.set(path, viewed: on) }
    if on { advance?() }
  }
}

/// A file row's mark: a quiet tick once viewed, a dot once it changed since.
struct ViewedMark: View {
  @Environment(\.theme) private var theme
  let state: ViewedFiles.State?

  var body: some View {
    switch state {
    case .viewed?:
      Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.textMuted).help("Viewed")
    case .changed?:
      Image(systemName: "circle.lefthalf.filled").foregroundStyle(theme.warning).help("Changed since you viewed it")
    default:
      EmptyView()
    }
  }
}

/// "12 of 40 viewed" over a thin bar, above a diff's file list.
struct ViewedProgress: View {
  @Environment(\.theme) private var theme
  let viewed: Int
  let total: Int

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("\(viewed) of \(total) viewed")
        .font(.scaled(size: 11))
        .foregroundStyle(theme.textSecondary)
      ProgressView(value: Double(viewed), total: Double(max(total, 1)))
        .progressViewStyle(.linear)
        .controlSize(.mini)
        .tint(theme.accent)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .accessibilityElement(children: .combine)
  }
}
