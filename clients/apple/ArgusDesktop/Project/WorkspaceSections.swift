import ArgusCore
import ArgusUI
import SwiftUI

struct SetupSection: View {
  @Binding var draft: ArgusConfigDraft

  var body: some View {
    SectionIntro(
      title: "Session setup",
      text: "What happens once when a worktree session is created. Order: copy → symlink → commands.")
    StringListEditor(
      label: "Copy", items: $draft.copy, placeholder: "path/to/dir or *.env (glob)", emptyLabel: "No copy patterns")
    StringListEditor(
      label: "Symlink", items: $draft.symlink, placeholder: "path/to/file or **/.env.local (glob)",
      emptyLabel: "No symlink patterns")
    StringListEditor(
      label: "Commands", items: $draft.commands, placeholder: "npm install", emptyLabel: "No setup commands")
    Section {
      TextField("Minimum Argus version", text: $draft.minArgusVersion, prompt: Text("0.10.0"))
    } footer: {
      Text("Optional semver string. The project home screen warns teammates running an older Argus build.")
    }
  }
}

struct WorkspaceEnvSection: View {
  @Binding var draft: ArgusConfigDraft
  @Environment(\.theme) private var theme

  var body: some View {
    SectionIntro(
      title: "Workspace environment",
      text: "Env vars set in every terminal and run command of a session, with a value unique to that session. Useful for port allocation."
    )
    if draft.workspaceEnv.isEmpty {
      Section { Text("No workspace env vars").foregroundStyle(theme.textMuted) }
    }
    ForEach($draft.workspaceEnv) { $env in
      Section {
        TextField("Name", text: $env.name, prompt: Text("e.g. ARGUS_PORT"))
        TextField("Base value", text: $env.baseValue, prompt: Text("8081"))
        TextField("Range", text: $env.range, prompt: Text("1000"))
        Picker("Strategy", selection: $env.strategy) {
          Text("Hash").tag(ArgusConfigDraft.EnvVar.Strategy.hash)
          Text("Sequential").tag(ArgusConfigDraft.EnvVar.Strategy.sequential)
        }
      } header: {
        HStack {
          Text(env.name.isEmpty ? "New variable" : env.name)
          Spacer()
          RemoveButton { draft.workspaceEnv.removeAll { $0.id == env.id } }
        }
      } footer: {
        Text(
          env.strategy == .hash
            ? "Derived from the branch name, modulo the range."
            : "Assigned from a counter when the session is created.")
      }
    }
    Section { AddButton("Add variable") { draft.workspaceEnv.append(.init()) } }
  }
}

struct TerminalsSection: View {
  @Binding var draft: ArgusConfigDraft
  @Environment(\.theme) private var theme

  var body: some View {
    SectionIntro(
      title: "Terminals",
      text: "Terminal tabs that auto-open in the bottom panel when a session is selected.")
    Section {
      if draft.terminals.isEmpty { Text("No terminals configured").foregroundStyle(theme.textMuted) }
      ForEach($draft.terminals) { $terminal in
        HStack {
          TextField("Name", text: $terminal.name, prompt: Text("Shell")).labelsHidden()
          TextField("Directory", text: $terminal.dir, prompt: Text(".")).labelsHidden()
            .font(.system(.body, design: .monospaced))
          RemoveButton { draft.terminals.removeAll { $0.id == terminal.id } }
        }
      }
      AddButton("Add terminal") { draft.terminals.append(.init()) }
    }
  }
}

struct BrowserSection: View {
  @Binding var draft: ArgusConfigDraft

  var body: some View {
    SectionIntro(
      title: "Browser",
      text: "The web runtime panel loads this URL on first open and exposes the device presets in its picker. Width and height are CSS pixels."
    )
    Section {
      TextField("Default URL", text: $draft.browserUrl, prompt: Text("http://localhost:3000"))
    }
    ForEach($draft.browserPresets) { $preset in
      Section {
        TextField("ID", text: $preset.key, prompt: Text("kiosk"))
        TextField("Label", text: $preset.label, prompt: Text("Defaults to the ID"))
        TextField("Width", text: $preset.width, prompt: Text("375"))
        TextField("Height", text: $preset.height, prompt: Text("667"))
        TextField("User agent", text: $preset.userAgent, prompt: Text("Desktop Chrome"))
      } header: {
        HStack {
          Text(preset.label.isEmpty ? (preset.key.isEmpty ? "New preset" : preset.key) : preset.label)
          Spacer()
          RemoveButton { draft.browserPresets.removeAll { $0.id == preset.id } }
        }
      }
    }
    Section { AddButton("Add device preset") { draft.browserPresets.append(.init()) } }
  }
}

struct RunCommandsSection: View {
  @Binding var draft: ArgusConfigDraft
  @Environment(\.theme) private var theme

  var body: some View {
    SectionIntro(
      title: "Run commands",
      text: "Entries shown in the run menu. Argus tracks each running command per session. Use Requires to declare startup dependencies between commands."
    )
    if draft.run.isEmpty {
      Section { Text("No run commands configured").foregroundStyle(theme.textMuted) }
    }
    ForEach(Array(draft.run.enumerated()), id: \.element.id) { index, command in
      let binding = $draft.run[index]
      Section {
        TextField("Title", text: binding.title, prompt: Text("e.g. Dev"))
        TextField("Command", text: binding.command, prompt: Text("e.g. pnpm dev"))
          .font(.system(.body, design: .monospaced))
        TextField("Directory", text: binding.cwd, prompt: Text("Worktree root"))
        Toggle("Restart when run again", isOn: binding.restartOnRerun)
        let options = draft.requirableTitles(for: command)
        if !options.isEmpty {
          LabeledContent("Requires") {
            FlowRow(spacing: 6) {
              ForEach(options, id: \.self) { title in
                Toggle(title, isOn: requires(index, title)).toggleStyle(.button).controlSize(.small)
              }
            }
          }
        }
      } header: {
        HStack {
          Text(command.title.isEmpty ? "New command" : command.title)
          Spacer()
          Button { draft.run.move(at: index, by: -1) } label: { Image(systemName: "chevron.up") }
            .buttonStyle(.argusBorderless).disabled(index == 0).accessibilityLabel("Move up")
          Button { draft.run.move(at: index, by: 1) } label: { Image(systemName: "chevron.down") }
            .buttonStyle(.argusBorderless).disabled(index == draft.run.count - 1).accessibilityLabel("Move down")
          RemoveButton { draft.run.removeAll { $0.id == command.id } }
        }
      }
    }
    Section {
      AddButton("Add run command") { draft.run.append(.init()) }
      Toggle("Only one runtime at a time across this project's sessions", isOn: $draft.singleRuntime)
    } footer: {
      Text("Pressing Run while another session's command is alive offers to stop it first. For run commands that claim a fixed port.")
    }
  }

  private func requires(_ index: Int, _ title: String) -> Binding<Bool> {
    Binding(
      get: { draft.run[index].requires.contains(title) },
      set: { on in
        draft.run[index].requires.removeAll { $0 == title }
        if on { draft.run[index].requires.append(title) }
      })
  }
}
