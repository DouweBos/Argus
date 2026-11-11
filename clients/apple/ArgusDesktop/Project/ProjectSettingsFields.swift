import ArgusCore
import ArgusUI
import SwiftUI

/// A section's title and what it does, as the desktop's detail header.
struct SectionIntro: View {
  let title: String
  let text: String
  @Environment(\.theme) private var theme
  @Environment(\.configSourceNote) private var sourceNote

  var body: some View {
    Section {
      EmptyView()
    } header: {
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.scaled(.title3).weight(.semibold)).foregroundStyle(theme.text)
        Text(text).font(.scaled(.callout)).foregroundStyle(theme.textSecondary)
          .fixedSize(horizontal: false, vertical: true)
        if let sourceNote { sourceNote.padding(.top, 2) }
      }
      .textCase(nil)
      .padding(.bottom, 4)
    }
  }
}

/// A list of one-line strings with add and remove.
struct StringListEditor: View {
  let label: String
  @Binding var items: [ArgusConfigDraft.ListItem]
  let placeholder: String
  let emptyLabel: String
  @Environment(\.theme) private var theme

  var body: some View {
    Section(label) {
      if items.isEmpty {
        Text(emptyLabel).foregroundStyle(theme.textMuted)
      }
      ForEach($items) { $item in
        HStack {
          TextField(label, text: $item.value, prompt: Text(placeholder))
            .labelsHidden()
            .font(.system(.body, design: .monospaced))
          RemoveButton { items.removeAll { $0.id == item.id } }
        }
      }
      AddButton("Add") { items.append(.init()) }
    }
  }
}

struct RemoveButton: View {
  let action: () -> Void
  var body: some View {
    Button(action: action) { Image(systemName: "minus.circle") }
      .buttonStyle(.argusBorderless)
      .help("Remove")
      .accessibilityLabel("Remove")
  }
}

struct AddButton: View {
  let title: String
  let action: () -> Void
  init(_ title: String, action: @escaping () -> Void) {
    self.title = title
    self.action = action
  }
  var body: some View {
    Button(action: action) { Label(title, systemImage: "plus") }.buttonStyle(.argusBorderless)
  }
}

/// Moves an element of `array` by one, for reorder buttons.
extension Array {
  mutating func move(at index: Int, by offset: Int) {
    let target = index + offset
    guard indices.contains(index), indices.contains(target) else { return }
    swapAt(index, target)
  }
}

/// Where a section's values come from, shown under its intro.
struct ConfigSourceNote: View {
  let source: ConfigSource
  let repoFile: Bool
  @Environment(\.theme) private var theme

  var body: some View {
    if let text {
      Label(text, systemImage: source == .repo ? "doc.text" : "laptopcomputer")
        .font(.scaled(.caption))
        .foregroundStyle(theme.textMuted)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var text: String? {
    switch source {
    case .repo: "From the checked-in .argus.json. Changes you save are stored on this Mac, layered over it."
    case .overridden: "Changed on this Mac, over the checked-in .argus.json."
    case .mac: repoFile ? "Set on this Mac only; the checked-in .argus.json doesn't set it." : nil
    case .unset: nil
    }
  }
}

extension EnvironmentValues {
  /// The open section's config source, for `SectionIntro`.
  @Entry var configSourceNote: ConfigSourceNote?
}
