import ArgusCore
import ArgusUI
import SwiftUI

/// A section's title and what it does, as the desktop's detail header.
struct SectionIntro: View {
  let title: String
  let text: String
  @Environment(\.theme) private var theme

  var body: some View {
    Section {
      EmptyView()
    } header: {
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.title3.weight(.semibold)).foregroundStyle(theme.text)
        Text(text).font(.callout).foregroundStyle(theme.textSecondary)
          .fixedSize(horizontal: false, vertical: true)
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
      .buttonStyle(.borderless)
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
    Button(action: action) { Label(title, systemImage: "plus") }.buttonStyle(.borderless)
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
