import ArgusCore
import SwiftUI

/// Rewrite a playbook by describing what should change.
///
/// The rewrite lands in the editor's draft, never on the computer: you read
/// the new text, keep or edit it, and the automation is only changed by the
/// save button on the screen underneath.
public struct RevisePlaybookSheet: View {
  @Environment(AutomationsStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  let playbook: String
  let name: String
  let onApply: (String) -> Void

  @State private var instruction = ""
  @State private var revised: String?
  @State private var revising = false
  @FocusState private var focused: Bool

  private static let title = "Rewrite the Playbook"
  private static let placeholder = "Check for a merged PR before calling a branch unshipped."
  private static let explanation = "The whole playbook is rewritten around this; the rest is kept."

  private var canRevise: Bool {
    !instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !revising
  }

  private var canApply: Bool {
    !revising && !(revised?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
  }

  private var revisedBinding: Binding<String> {
    Binding(get: { revised ?? "" }, set: { revised = $0 })
  }

  public init(playbook: String, name: String, onApply: @escaping (String) -> Void) {
    self.playbook = playbook
    self.name = name
    self.onApply = onApply
  }

  private func apply() {
    if let revised { onApply(revised) }
    dismiss()
  }

  private func revise() {
    guard canRevise else { return }
    revising = true
    Task {
      let result = await store.revisePlaybook(
        playbook: playbook, instruction: instruction, name: name.isEmpty ? nil : name)
      revising = false
      guard let result else { return }
      revised = result
    }
  }

  // MARK: - Layout

  #if os(macOS)
    public var body: some View {
      VStack(alignment: .leading, spacing: 14) {
        VStack(alignment: .leading, spacing: 4) {
          Text(Self.title).font(.scaled(.headline))
          MutedText("Say what should change; Claude rewrites the playbook around it.")
        }
        VStack(alignment: .leading, spacing: 6) {
          ThemedTextField(placeholder: Self.placeholder, text: $instruction, multiline: true, lines: 3...6)
            .focused($focused)
          Text("Nothing is saved until you save the automation.")
            .font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
        }
        if revised != nil {
          VStack(alignment: .leading, spacing: 6) {
            Text("Revised playbook").font(.scaled(size: 12, weight: .medium)).foregroundStyle(theme.textMuted)
            ThemedTextField(placeholder: "Playbook", text: revisedBinding, multiline: true, lines: 10...18, mono: true)
            Text("Edit it here if you want; applying replaces the playbook in the editor.")
              .font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
          }
        }
        if let error = store.error {
          Text(error).font(.scaled(size: 12)).foregroundStyle(theme.error).textSelection(.enabled)
        }
        footer
      }
      .padding(20)
      .frame(width: 560)
      .fixedSize(horizontal: false, vertical: true)
      .task { focused = true }
    }

    private var footer: some View {
      HStack(spacing: 8) {
        if revising {
          ProgressView().controlSize(.small)
          MutedText("Rewriting the playbook…")
        }
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        if revised == nil {
          Button(revising ? "Rewriting…" : "Rewrite") { revise() }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(!canRevise)
        } else {
          Button("Rewrite Again") { revise() }.disabled(!canRevise)
          Button("Apply") { apply() }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(!canApply)
        }
      }
    }
  #else
    public var body: some View {
      NavigationStack {
        Screen {
          if let error = store.error {
            Banner(text: error, tone: .danger)
          }
          Field(label: "WHAT SHOULD CHANGE?", caption: Self.explanation) {
            ThemedTextField(placeholder: Self.placeholder, text: $instruction, multiline: true, lines: 3...8)
              .focused($focused)
            Btn(
              label: revising ? "Rewriting…" : (revised == nil ? "Rewrite" : "Rewrite again"),
              tone: .secondary, small: true
            ) { revise() }
              .disabled(!canRevise)
          }

          if revised != nil {
            Field(label: "Revised playbook", caption: "Edit it here if you want.") {
              ThemedTextField(placeholder: "Playbook", text: revisedBinding, multiline: true, lines: 8...24, mono: true)
            }
          }
        }
        .navigationTitle(Self.title)
        .inlineNavigationTitle()
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Apply") { apply() }.disabled(!canApply)
          }
        }
        .task { focused = true }
      }
    }
  #endif
}
