import ArgusCore
import SwiftUI

/// New branch, as the Mac's sheet: a name, what it starts from, and whether to
/// check it out.
struct NewBranchSheet: View {
  @Environment(\.dismiss) private var dismiss

  let branches: [RemoteGitBranch]
  let startPoint: String?
  let onSubmit: (_ name: String, _ startPoint: String?, _ checkout: Bool) async -> Void

  @State private var name = ""
  @State private var start = ""
  @State private var checkout = true
  @State private var saving = false

  private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  /// Local branches first, then remote-only ones, each by its git ref.
  private var refs: [String] {
    let local = branches.filter { $0.scope == .local }.map(\.ref)
    let remote = branches.filter { $0.scope == .remote }.map(\.ref)
    let all = local + remote
    return all.contains(start) || start.isEmpty ? all : [start] + all
  }

  var body: some View {
    NavigationStack {
      Screen {
        Field(label: "Branch name") {
          ThemedTextField(placeholder: "new-branch-name", text: $name, mono: true, input: .code)
        }
        Field(label: "From", caption: start.isEmpty ? "Whatever is checked out now." : nil) {
          MenuChip(
            "From", selection: $start,
            options: [.init(value: "", label: "Checked-out branch")] + refs.map { .init(value: $0, label: $0) },
            icon: Icon.branch, mono: !start.isEmpty)
        }
        Toggle(isOn: $checkout) { MutedText("Check out after creating") }
          .toggleStyle(.argusSwitch)
      }
      .navigationTitle("New branch")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(saving ? "Creating…" : "Create") {
            saving = true
            Task {
              await onSubmit(trimmed, start.isEmpty ? nil : start, checkout)
              dismiss()
            }
          }
          .disabled(trimmed.isEmpty || saving)
        }
      }
      .onAppear { start = startPoint ?? "" }
    }
    .presentationDetents([.medium, .large])
  }
}

/// A branch's new name.
struct BranchNameSheet: View {
  @Environment(\.dismiss) private var dismiss

  let title: String
  let initial: String
  let onSubmit: (String) async -> Void

  @State private var name = ""
  @State private var saving = false

  private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack {
      Screen {
        Field(label: "Branch name") {
          ThemedTextField(placeholder: "new-branch-name", text: $name, mono: true, input: .code)
        }
      }
      .navigationTitle(title)
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(saving ? "Saving…" : "Save") {
            saving = true
            Task {
              await onSubmit(trimmed)
              dismiss()
            }
          }
          .disabled(trimmed.isEmpty || trimmed == initial || saving)
        }
      }
      .onAppear { name = initial }
    }
    .presentationDetents([.medium])
  }
}
