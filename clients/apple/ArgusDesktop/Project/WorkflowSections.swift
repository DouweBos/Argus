import ArgusCore
import ArgusUI
import SwiftUI

struct BranchProtectionSection: View {
  @Binding var draft: ArgusConfigDraft

  var body: some View {
    SectionIntro(
      title: "Branch protection",
      text: "Sessions whose base branch matches a protected branch are merged through a pull request instead of a direct merge."
    )
    StringListEditor(
      label: "Protected branches", items: $draft.protectedBranches, placeholder: "main",
      emptyLabel: "No protected branches")
    Section {
      TextField("Default source branch", text: $draft.defaultBaseBranch, prompt: Text("staging"))
    } footer: {
      Text(
        "Branch preselected as the source when creating a new session. When empty, Argus probes for staging, develop, dev, main, then master."
      )
    }
    Section {
      Picker("Auto-fetch", selection: $draft.autoFetchMinutes) {
        ForEach(fetchOptions, id: \.self) { minutes in
          Text(minutes == 0 ? "Off" : "\(minutes) min").tag(minutes)
        }
      }
    } footer: {
      Text("Runs git fetch --prune in the background at this interval for every active session in the project.")
    }
    Section("Advanced") {
      TextField("Preferred PR template filename", text: $draft.pullRequestTemplate, prompt: Text("feature.md"))
      Text(
        "Only relevant when the repo has multiple PR templates under .github/PULL_REQUEST_TEMPLATE/. For the common single-template case GitHub auto-applies the file and this field does nothing."
      )
      .font(.scaled(.caption)).foregroundStyle(.secondary)
    }
  }

  /// The panel's choices, plus a hand-edited value so it isn't silently changed.
  private var fetchOptions: [Int] {
    let options = ArgusConfigDraft.autoFetchOptions
    return options.contains(draft.autoFetchMinutes) ? options : (options + [draft.autoFetchMinutes]).sorted()
  }
}

struct AgentSection: View {
  @Binding var draft: ArgusConfigDraft

  var body: some View {
    SectionIntro(
      title: "Agent",
      text: "Agent-level options for this project."
    )
    Section {
      Toggle("Save chat history when agents stop", isOn: $draft.saveChatHistory)
      Toggle("Continue agents automatically when a usage limit resets", isOn: $draft.autoContinueOnLimit)
    }
  }
}

struct LLMSection: View {
  @Binding var draft: ArgusConfigDraft
  @Environment(HostStore.self) private var store

  var body: some View {
    SectionIntro(
      title: "LLM",
      text: "Project-level default LLM runner and model. Used when an agent or session does not pin its own. The runner is bound at session creation; the model is re-resolved per agent spawn. Leave blank to fall back to your app-level default."
    )
    Section {
      Picker("Runner", selection: $draft.llmRunner) {
        Text("Inherit app default").tag("")
        ForEach(runners, id: \.id) { Text($0.label).tag($0.id) }
      }
    } footer: {
      Text("The CLI/agent that drives sessions. Unknown ids also fall back to the app default.")
    }
    Section {
      TextField("Model", text: $draft.llmModel, prompt: Text("claude-opus-4-7"))
    } footer: {
      Text("Default model id, in whatever shape the runner expects. Leave blank to let the runner pick.")
    }
  }

  /// Registered runners, plus a saved id this app doesn't know, so saving
  /// doesn't quietly change it.
  private var runners: [(id: String, label: String)] {
    var list = store.runners.map { (id: $0.id, label: $0.displayName) }
    if list.isEmpty { list = [("claude-code", "Claude Code")] }
    if !draft.llmRunner.isEmpty, !list.contains(where: { $0.id == draft.llmRunner }) {
      list.append((draft.llmRunner, "\(draft.llmRunner) (unknown)"))
    }
    return list
  }
}

struct RelatedProjectsSection: View {
  @Binding var draft: ArgusConfigDraft
  @Environment(\.theme) private var theme

  var body: some View {
    SectionIntro(
      title: "Related projects",
      text: "Other repositories that agents in this project may spawn worktrees in. Paths are repo-root relative. Surfaced via the list_projects MCP tool."
    )
    Section {
      if draft.relatedProjects.isEmpty { Text("No related projects").foregroundStyle(theme.textMuted) }
      ForEach($draft.relatedProjects) { $project in
        HStack {
          TextField("Path", text: $project.path, prompt: Text("../other-repo")).labelsHidden()
            .font(.system(.body, design: .monospaced))
          TextField("Description", text: $project.description, prompt: Text("What it is")).labelsHidden()
          RemoveButton { draft.relatedProjects.removeAll { $0.id == project.id } }
        }
      }
      AddButton("Add related project") { draft.relatedProjects.append(.init()) }
    }
  }
}

struct ReleaseNotesSection: View {
  @Binding var draft: ArgusConfigDraft
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var preview: [ArgusProtocol.ReleaseNoteEntry]?
  @State private var previewError: String?

  var body: some View {
    SectionIntro(
      title: "Release notes",
      text: "Glob patterns surfaced on the session home screen as release notes. Pick a format per pattern (changesets / regex / json / yaml / xml). The preview shows every file in the repo currently matching your globs so you can verify the config — only files added or modified on a session branch are listed at runtime."
    )
    ForEach($draft.releaseNotes) { $pattern in
      Section {
        TextField("Glob", text: $pattern.glob, prompt: Text(".changeset/*.md"))
          .font(.system(.body, design: .monospaced))
        Picker("Format", selection: $pattern.format) {
          ForEach(ArgusConfigDraft.ReleasePattern.formats, id: \.self) { Text($0).tag($0) }
        }
        if pattern.format == "changesets" {
          Text("Labels come from the YAML frontmatter automatically.").font(.scaled(.caption)).foregroundStyle(theme.textMuted)
        } else {
          ForEach($pattern.labels) { $label in
            HStack {
              TextField("Name", text: $label.name, prompt: Text("name (e.g. type)")).labelsHidden()
              TextField("Selector", text: $label.selector, prompt: Text(selectorHint(pattern.format))).labelsHidden()
                .font(.system(.body, design: .monospaced))
              Picker("Tone", selection: $label.tone) {
                ForEach(ArgusConfigDraft.ReleasePattern.Label.tones, id: \.self) { Text($0.isEmpty ? "default" : $0).tag($0) }
              }
              .labelsHidden().fixedSize()
              RemoveButton { pattern.labels.removeAll { $0.id == label.id } }
            }
          }
          AddButton("Add label") { pattern.labels.append(.init()) }
        }
      } header: {
        HStack {
          Text(pattern.glob.isEmpty ? "New pattern" : pattern.glob)
          Spacer()
          RemoveButton { draft.releaseNotes.removeAll { $0.id == pattern.id } }
        }
      }
    }
    Section { AddButton("Add pattern") { draft.releaseNotes.append(.init()) } }
    if !draft.releasePatternValues.isEmpty {
      Section("Matching files") {
        if let previewError {
          Text(previewError).foregroundStyle(theme.error)
        } else if let preview {
          if preview.isEmpty { Text("No files match yet.").foregroundStyle(theme.textMuted) }
          ForEach(preview, id: \.filename) { entry in
            HStack {
              Text(entry.filename).font(.system(.callout, design: .monospaced))
              Spacer()
              ForEach(Array(entry.labels.enumerated()), id: \.offset) { _, label in
                Badge(label: label.value, tone: .accent).fixedSize()
              }
            }
          }
        } else {
          ProgressView().controlSize(.small)
        }
      }
      .task(id: ConfigJSON.string(.array(draft.releasePatternValues))) { await loadPreview() }
    }
  }

  private func selectorHint(_ format: String) -> String {
    format == "regex" ? "^Type:\\s*(.+)$" : "meta.type"
  }

  /// Debounced: every keystroke would otherwise re-glob the repo.
  private func loadPreview() async {
    try? await Task.sleep(for: .milliseconds(250))
    guard !Task.isCancelled, let backend = model.backend, let repoRoot = model.projectSettingsRepo else { return }
    do {
      let patterns = try draft.releasePatternValues.map {
        try ProtocolCodec.convert($0, to: ArgusProtocol.ReleaseNotePatternConfig.self)
      }
      preview = try await backend.request(
        ArgusProtocol.Commands.PreviewReleaseNotes.self, .init(repoRoot: repoRoot, patterns: patterns)
      ).entries
      previewError = nil
    } catch {
      previewError = HostStore.describe(error)
    }
  }
}
