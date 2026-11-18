import ArgusCore
import SwiftUI

/// What a rewrite sheet calls its text and its states.
public struct ReviseTextCopy: Sendable {
  public var title: String
  public var subtitle: String
  public var placeholder: String
  public var explanation: String
  /// "Nothing is saved until you save the automation."
  public var savedHint: String
  /// The rewritten text's label, e.g. "Revised playbook".
  public var resultLabel: String
  /// Shown while Claude works, e.g. "Rewriting the playbook".
  public var progress: String

  public init(
    title: String, subtitle: String, placeholder: String, explanation: String, savedHint: String,
    resultLabel: String, progress: String
  ) {
    self.title = title
    self.subtitle = subtitle
    self.placeholder = placeholder
    self.explanation = explanation
    self.savedHint = savedHint
    self.resultLabel = resultLabel
    self.progress = progress
  }
}

/// Rewrite a piece of text by describing what should change.
///
/// The rewrite lands in the editor's draft, never on the computer: you read
/// the new text, keep or edit it, and nothing changes until the screen
/// underneath saves.
public struct ReviseTextSheet: View {
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  let copy: ReviseTextCopy
  let error: String?
  let revise: (String) async -> String?
  let onApply: (String) -> Void

  @State private var instruction = ""
  @State private var revised: String?
  @State private var revising = false
  @FocusState private var focused: Bool

  private var canRevise: Bool {
    !instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !revising
  }

  private var canApply: Bool {
    !revising && !(revised?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
  }

  private var revisedBinding: Binding<String> {
    Binding(get: { revised ?? "" }, set: { revised = $0 })
  }

  /// `revise` returns the rewritten text, or nil with `error` set.
  public init(
    copy: ReviseTextCopy, error: String?, revise: @escaping (String) async -> String?,
    onApply: @escaping (String) -> Void
  ) {
    self.copy = copy
    self.error = error
    self.revise = revise
    self.onApply = onApply
  }

  private func apply() {
    if let revised { onApply(revised) }
    dismiss()
  }

  private func run() {
    guard canRevise else { return }
    revising = true
    Task {
      let result = await revise(instruction)
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
          Text(copy.title).font(.scaled(.headline))
          MutedText(copy.subtitle)
        }
        VStack(alignment: .leading, spacing: 6) {
          ThemedTextField(placeholder: copy.placeholder, text: $instruction, multiline: true, lines: 3...6)
            .focused($focused)
          Text(copy.savedHint)
            .font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
        }
        if revised != nil {
          VStack(alignment: .leading, spacing: 6) {
            Text(copy.resultLabel).font(.scaled(size: 12, weight: .medium)).foregroundStyle(theme.textMuted)
            ThemedTextField(placeholder: copy.resultLabel, text: revisedBinding, multiline: true, lines: 10...18, mono: true)
            Text("Edit it here if you want; applying replaces the text in the editor.")
              .font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
          }
        }
        if let error {
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
          MutedText(copy.progress)
        }
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        if revised == nil {
          Button(revising ? "Rewriting" : "Rewrite") { run() }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(!canRevise)
        } else {
          Button("Rewrite Again") { run() }.disabled(!canRevise)
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
          if let error {
            Banner(text: error, tone: .danger)
          }
          Field(label: "WHAT SHOULD CHANGE?", caption: copy.explanation) {
            ThemedTextField(placeholder: copy.placeholder, text: $instruction, multiline: true, lines: 3...8)
              .focused($focused)
            Btn(
              label: revising ? "Rewriting" : (revised == nil ? "Rewrite" : "Rewrite again"),
              tone: .secondary, small: true
            ) { run() }
              .disabled(!canRevise)
          }

          if revised != nil {
            Field(label: copy.resultLabel, caption: "Edit it here if you want.") {
              ThemedTextField(placeholder: copy.resultLabel, text: revisedBinding, multiline: true, lines: 8...24, mono: true)
            }
          }
        }
        .navigationTitle(copy.title)
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
