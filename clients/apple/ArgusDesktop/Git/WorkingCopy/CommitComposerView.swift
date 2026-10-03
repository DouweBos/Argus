import ArgusUI
import GroveKit
import SwiftUI

/// Subject, body and options under the Changes list, as Electron's CommitPanel.
struct CommitComposerView: View {
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    @Bindable var vm = vm
    VStack(alignment: .leading, spacing: 6) {
      TextField("Summary", text: $vm.commitSubject)
        .textFieldStyle(.roundedBorder)
        .onSubmit { commit() }
      TextField("Description", text: $vm.commitBody, axis: .vertical)
        .textFieldStyle(.roundedBorder)
        .lineLimit(3...8)
      HStack(spacing: 10) {
        Toggle("Amend", isOn: Binding(get: { vm.isAmend }, set: { on in Task { await vm.setAmend(on) } }))
        Toggle("Sign-off", isOn: Binding(get: { vm.signOff }, set: { vm.setSignOff($0) }))
          .help("Add a Signed-off-by trailer")
        if vm.isSigningAvailable {
          Toggle("Sign", isOn: Binding(get: { vm.signCommit }, set: { vm.setSignCommit($0) }))
            .help("Sign the commit with your configured key")
        }
        Spacer()
      }
      .toggleStyle(.checkbox)
      .controlSize(.small)
      HStack(spacing: 8) {
        if let identity = vm.identity {
          Label("\(identity.name) <\(identity.email)>", systemImage: "person.crop.circle")
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .truncationMode(.middle)
            .help("Commits are authored as this identity")
        }
        Spacer(minLength: 4)
        Button(vm.commitButtonTitle, action: commit)
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.return, modifiers: .command)
          .disabled(!vm.canCommit)
          .help(disabledReason ?? "Commit (⌘↩)")
      }
    }
    .font(.system(size: 12))
    .padding(10)
  }

  private var disabledReason: String? {
    if !vm.conflictedFiles.isEmpty { return "Resolve the conflicts first" }
    if !vm.isAmend && vm.stagedFiles.isEmpty { return "Stage changes to commit" }
    if vm.commitSubject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Enter a summary" }
    return nil
  }

  private func commit() {
    guard vm.canCommit else { return }
    Task { await WorkingCopyActions(workspace: workspace).commit() }
  }
}
