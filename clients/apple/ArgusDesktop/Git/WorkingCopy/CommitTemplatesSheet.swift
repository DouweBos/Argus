import ArgusUI
import GroveKit
import SwiftUI

/// Add, edit, reorder and delete the commit templates every composer offers.
struct CommitTemplatesSheet: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let store: CommitTemplateStore
  @State private var selection: CommitTemplate.ID?

  var body: some View {
    VStack(spacing: 0) {
      HStack(alignment: .top, spacing: 0) {
        VStack(spacing: 0) {
          List(selection: $selection) {
            ForEach(store.templates) { template in
              Text(template.name.isEmpty ? "Untitled" : template.name).tag(template.id)
            }
            .onMove { store.move(fromOffsets: $0, toOffset: $1) }
          }
          HStack(spacing: 4) {
            Button { selection = store.add().id } label: { Image(systemName: "plus") }
              .accessibilityLabel("Add template")
            Button {
              if let selection { store.delete(selection) }
              selection = nil
            } label: { Image(systemName: "minus") }
              .disabled(selection == nil)
              .accessibilityLabel("Delete template")
            Spacer()
            Button("Restore Defaults") { store.resetToDefaults() }
          }
          .buttonStyle(.argusBorderless)
          .padding(8)
        }
        .frame(width: 220)
        Divider()
        editor.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
      Divider()
      HStack {
        Text("`/` in the summary picks one too; a repository's commit.template comes first.")
          .font(.scaled(size: 11))
          .foregroundStyle(theme.textMuted)
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.defaultAction)
      }
      .padding(12)
    }
    .frame(width: 640, height: 400)
  }

  @ViewBuilder private var editor: some View {
    if let id = selection, let template = store.templates.first(where: { $0.id == id }) {
      Form {
        TextField("Name", text: binding(template, \.name))
        TextField("Summary", text: binding(template, \.summary))
        TextField("Description", text: binding(template, \.body), axis: .vertical)
          .lineLimit(4...10)
      }
      .formStyle(.grouped)
    } else {
      Text("Select a template to edit it.")
        .foregroundStyle(theme.textMuted)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func binding(_ template: CommitTemplate, _ key: WritableKeyPath<CommitTemplate, String>) -> Binding<String> {
    Binding(
      get: { store.templates.first { $0.id == template.id }?[keyPath: key] ?? "" },
      set: { value in
        guard var current = store.templates.first(where: { $0.id == template.id }) else { return }
        current[keyPath: key] = value
        store.update(current)
      })
  }
}
