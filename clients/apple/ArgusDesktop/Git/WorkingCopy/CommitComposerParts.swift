import ArgusUI
import GroveKit
import SwiftUI

/// Who commits here, and switching it to a saved profile — written to this
/// repository's own config, so other repositories keep theirs.
struct IdentityMenu: View {
  let workspace: GitWorkspace
  @State private var profiles = CommitPreferences.profiles()
  @State private var naming = false
  @State private var label = ""

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    Menu {
      ForEach(profiles) { profile in
        Button {
          Task {
            vm.clearError()
            await vm.switchIdentity(to: profile)
            workspace.track(.identity, success: vm.errorMessage == nil)
          }
        } label: {
          if profile.matches(vm.identity) {
            Label("\(profile.title) — \(profile.email)", systemImage: "checkmark")
          } else {
            Text("\(profile.title) — \(profile.email)")
          }
        }
      }
      if !profiles.isEmpty { Divider() }
      if let identity = vm.identity, !profiles.contains(where: { $0.matches(identity) }) {
        Button("Save “\(identity.email)” as a Profile…") {
          label = ""
          naming = true
        }
      }
      if !profiles.isEmpty {
        Menu("Remove Profile") {
          ForEach(profiles) { profile in
            Button(profile.title) { save(IdentityProfiles.removing(profile.id, from: profiles)) }
          }
        }
      }
    } label: {
      Label(vm.identity.map { "\($0.name) <\($0.email)>" } ?? "No identity", systemImage: "person.crop.circle")
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .menuStyle(.borderlessButton)
    .font(.scaled(size: 11))
    .foregroundStyle(.secondary)
    .fixedSize(horizontal: false, vertical: true)
    .help("Commits are authored as this identity — pick a saved profile to switch this repository")
    .onAppear { profiles = CommitPreferences.profiles() }
    .alert("Save Identity Profile", isPresented: $naming) {
      TextField("Name, e.g. Work", text: $label)
      Button("Save") {
        if let identity = vm.identity { save(IdentityProfiles.adding(identity, label: label, to: profiles)) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("Saved profiles can be picked in any repository.")
    }
  }

  private func save(_ next: [UserProfile]) {
    profiles = next
    CommitPreferences.setProfiles(next)
  }
}

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
          .buttonStyle(.borderless)
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
