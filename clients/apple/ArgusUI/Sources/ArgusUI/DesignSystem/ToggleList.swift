import SwiftUI

/// A short multi-select picked in place: one switch per option, the Mac's
/// project and source toggles. `selection` keeps the order things were turned on.
public struct ToggleList: View {
  public struct Option: Identifiable {
    public var id: String
    public var label: String
    public var hint: String?
    /// An SF Symbol before the label, as the Mac's project rows have.
    public var icon: String?

    public init(id: String, label: String, hint: String? = nil, icon: String? = nil) {
      self.id = id
      self.label = label
      self.hint = hint
      self.icon = icon
    }
  }

  @Environment(\.theme) private var theme
  let options: [Option]
  @Binding var selection: [String]
  var emptyMessage: String?
  var title: String?

  /// A `title` adds the Mac's scope header: the title, Select All / Clear and "n of m".
  public init(
    title: String? = nil, options: [Option], selection: Binding<[String]>, emptyMessage: String? = nil
  ) {
    self.title = title
    self.options = options
    self._selection = selection
    self.emptyMessage = emptyMessage
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let title { header(title) }
      if options.isEmpty, let emptyMessage { MutedText(emptyMessage) }
      ForEach(options) { option in
        Toggle(isOn: member(option.id)) {
          HStack(spacing: 10) {
            if let icon = option.icon {
              Image(systemName: icon).font(.scaled(size: 15)).foregroundStyle(theme.textSecondary)
            }
            VStack(alignment: .leading, spacing: 1) {
              Text(option.label).font(.scaled(size: 15)).lineLimit(1)
              if let hint = option.hint { MutedText(hint).lineLimit(1) }
            }
          }
        }
        .toggleStyle(.argusSwitch)
      }
    }
  }

  private func header(_ title: String) -> some View {
    let ids = options.map(\.id)
    let picked = ids.filter(selection.contains).count
    return HStack(spacing: 10) {
      Text(title).font(.scaled(size: 13, weight: .medium)).foregroundStyle(theme.textSecondary)
      Spacer(minLength: 6)
      if ids.count > 1 {
        Button(picked == ids.count ? "Clear" : "Select All") {
          if picked == ids.count {
            selection.removeAll { ids.contains($0) }
          } else {
            selection.append(contentsOf: ids.filter { !selection.contains($0) })
          }
        }
        .font(.scaled(size: 13, weight: .medium))
        .buttonStyle(.argusBorderless)
      }
      if !ids.isEmpty {
        Text("\(picked) of \(ids.count)")
          .font(.scaled(size: 13)).monospacedDigit().foregroundStyle(theme.textMuted)
      }
    }
  }

  private func member(_ id: String) -> Binding<Bool> {
    Binding(
      get: { selection.contains(id) },
      set: { selection = Self.toggled(selection, id, on: $0) })
  }

  static func toggled(_ selection: [String], _ id: String, on: Bool) -> [String] {
    var next = selection.filter { $0 != id }
    if on { next.append(id) }
    return next
  }
}

#Preview("ToggleList") {
  @Previewable @State var picked = ["argus"]
  ToggleList(
    options: [
      .init(id: "argus", label: "Argus"),
      .init(id: "web", label: "Website", hint: "not configured"),
    ],
    selection: $picked
  )
  .padding()
}
