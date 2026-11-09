import ArgusUI
import GroveKit
import SwiftUI

/// Subject, body and options over the Changes list, as Electron's CommitPanel,
/// plus templates, gitmoji and the identity switcher, flat on the canvas.
struct CommitComposerView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  @State private var managingTemplates = false
  @State private var pickingGitmoji = false
  @FocusState private var subjectFocused: Bool

  private var vm: WorkingCopyViewModel { workspace.workingCopy }

  var body: some View {
    @Bindable var vm = vm
    VStack(alignment: .leading, spacing: 10) {
      // Summary and description share one quiet field box.
      VStack(alignment: .leading, spacing: 0) {
        TextField("Summary", text: $vm.commitSubject)
          .textFieldStyle(.plain)
          .font(.scaled(size: 12, weight: .medium))
          .focused($subjectFocused)
          .onSubmit { if !vm.acceptAutoComplete() { commit() } }
          .onKeyPress(.upArrow) { moveHighlight(-1) }
          .onKeyPress(.downArrow) { moveHighlight(1) }
          .onKeyPress(.escape) {
            guard vm.isAutoCompleteVisible else { return .ignored }
            vm.dismissAutoComplete()
            return .handled
          }
          .padding(.horizontal, 9)
          .padding(.vertical, 7)
        if vm.isAutoCompleteVisible {
          CommitAutoCompleteList(vm: vm) { track(vm.autoCompleteTrigger == .gitmoji ? .gitmoji : .template) }
            .padding(.horizontal, 6)
        }
        Rectangle().fill(theme.border).frame(height: 1)
        TextField("Description", text: $vm.commitBody, axis: .vertical)
          .textFieldStyle(.plain)
          .lineLimit(3...8)
          .padding(.horizontal, 9)
          .padding(.vertical, 7)
        HStack(spacing: 2) {
          Spacer()
          gitmojiButton
          templatesMenu
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 4)
      }
      .background(theme.selection, in: .rect(cornerRadius: 6))
      HStack(spacing: 12) {
        Toggle("Amend", isOn: Binding(get: { vm.isAmend }, set: { on in Task { await vm.setAmend(on) } }))
        Toggle("Sign Off", isOn: Binding(get: { vm.signOff }, set: { vm.setSignOff($0) }))
          .help("Add a Signed-off-by trailer")
        if vm.isSigningAvailable {
          Toggle("Sign", isOn: Binding(get: { vm.signCommit }, set: { vm.setSignCommit($0) }))
            .help("Sign the commit with your configured key")
        }
        Spacer()
      }
      .toggleStyle(.quietCheckbox)
      HStack(spacing: 8) {
        IdentityMenu(workspace: workspace)
        Spacer(minLength: 4)
        Button("Review") { Task { await model.requestCodeReview(session: workspace.sessionId) } }
          .buttonStyle(.secondary)
          .disabled(vm.changedCount == 0 && workspace.isProjectRoot)
          .help("Ask a new agent to review these changes before you commit")
        Button(vm.commitButtonTitle, action: commit)
          .buttonStyle(AccentButtonStyle())
          .keyboardShortcut(.return, modifiers: .command)
          .disabled(!vm.canCommit)
          .help(disabledReason ?? "Commit (⌘↩)")
      }
    }
    .font(.scaled(size: 12))
    .padding(12)
    .sheet(isPresented: $managingTemplates) { CommitTemplatesSheet(store: CommitPreferences.templates) }
  }

  private var gitmojiButton: some View {
    Button { pickingGitmoji.toggle() } label: { Image(systemName: "face.smiling") }
      .buttonStyle(FlatIconButtonStyle(selected: pickingGitmoji, size: 22))
      .help("Gitmoji (or type : in the summary)")
      .accessibilityLabel("Gitmoji")
      .popover(isPresented: $pickingGitmoji, arrowEdge: .bottom) {
        GitmojiPicker { gitmoji in
          pickingGitmoji = false
          vm.insertGitmoji(gitmoji)
          track(.gitmoji)
          subjectFocused = true
        }
      }
  }

  private var templatesMenu: some View {
    Menu {
      ForEach(vm.availableTemplates) { template in
        Button(template.name) {
          vm.applyTemplate(template)
          track(.template)
        }
      }
      if !vm.availableTemplates.isEmpty { Divider() }
      Button("Manage Templates…") { managingTemplates = true }
    } label: {
      Image(systemName: "text.badge.plus")
    }
    .menuStyle(.button)
    .clickable()
    .buttonStyle(FlatIconButtonStyle(size: 22))
    .menuIndicator(.hidden)
    .fixedSize()
    .help("Commit templates (or type / in the summary)")
    .accessibilityLabel("Commit templates")
  }

  private func moveHighlight(_ delta: Int) -> KeyPress.Result {
    guard vm.isAutoCompleteVisible else { return .ignored }
    vm.moveAutoCompleteHighlight(by: delta)
    return .handled
  }

  private func track(_ action: MacTelemetryEvent.GitAction) {
    workspace.track(action, success: true)
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

/// The summary field's suggestions: `#` issues, `c:` commits, backticked
/// files, `/` templates and `:` gitmoji.
private struct CommitAutoCompleteList: View {
  @Environment(\.theme) private var theme
  let vm: WorkingCopyViewModel
  let onPick: () -> Void

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(vm.autoCompleteSuggestions.prefix(40)) { suggestion in
          Button {
            vm.applyAutoComplete(suggestion)
            onPick()
          } label: {
            HStack(spacing: 6) {
              Image(systemName: suggestion.icon).frame(width: 16).foregroundStyle(theme.textMuted)
              Text(suggestion.title).lineLimit(1)
              if let subtitle = suggestion.subtitle {
                Text(subtitle).foregroundStyle(theme.textMuted).lineLimit(1)
              }
              Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(
              suggestion.id == vm.autoCompleteHighlight ? theme.accent.opacity(0.2) : .clear,
              in: .rect(cornerRadius: 4))
            .contentShape(.rect)
          }
          .buttonStyle(.argusPlain)
          .onHover { if $0 { vm.highlightAutoComplete(suggestion.id) } }
        }
      }
      .padding(4)
    }
    .frame(height: min(160, CGFloat(min(vm.autoCompleteSuggestions.count, 40)) * 22 + 8))
    .background(theme.bgTertiary, in: .rect(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border))
  }
}

/// Every gitmoji, searchable by code or description.
private struct GitmojiPicker: View {
  @Environment(\.theme) private var theme
  let pick: (Gitmoji) -> Void
  @State private var query = ""

  var body: some View {
    VStack(spacing: 6) {
      TextField("Search gitmoji", text: $query)
        .textFieldStyle(.roundedBorder)
      List(Gitmoji.search(query)) { gitmoji in
        Button { pick(gitmoji) } label: {
          HStack(spacing: 8) {
            Text(gitmoji.emoji)
            Text(gitmoji.code).font(.scaled(size: 11, design: .monospaced))
            Text(gitmoji.description).foregroundStyle(theme.textMuted).lineLimit(1)
            Spacer(minLength: 0)
          }
          .contentShape(.rect)
        }
        .buttonStyle(.argusPlain)
      }
      .listStyle(.plain)
    }
    .padding(8)
    .frame(width: 380, height: 360)
  }
}
