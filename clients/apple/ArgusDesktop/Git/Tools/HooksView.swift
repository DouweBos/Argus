import ArgusUI
import GroveKit
import SwiftUI

/// The repository's installed hooks, and running one by hand with its last
/// output, as Electron's `HooksView`.
struct HooksView: View {
  @Environment(HostStore.self) private var store
  let workspace: GitWorkspace

  @State private var hooks: [ArgusProtocol.GitHook]?
  @State private var loadError: String?
  @State private var selected: String?
  @State private var running: String?

  var body: some View {
    VStack(spacing: 0) {
      GitToolHeader(title: "Hooks", caption: "Executable files in .git/hooks, run by hand.") {
        Button("Run") { if let selected { run(selected) } }
          .disabled(selectedHook?.executable != true || running != nil)
      }
      Divider()
      content
    }
    .task(id: workspace.generation) { await load() }
  }

  private var selectedHook: ArgusProtocol.GitHook? {
    hooks?.first { $0.name == selected }
  }

  @ViewBuilder
  private var content: some View {
    if let loadError {
      ContentUnavailableView {
        Label("Couldn't list hooks", systemImage: "exclamationmark.triangle")
      } description: {
        Text(loadError)
      } actions: {
        Button("Try Again") { Task { await load() } }
      }
    } else if let hooks {
      if hooks.isEmpty {
        ContentUnavailableView(
          "No hooks installed", systemImage: "link",
          description: Text("Add an executable file under .git/hooks to run it from here."))
      } else {
        VSplitView {
          List(hooks, id: \.name, selection: $selected) { hook in
            HookRow(hook: hook, running: running == hook.name) { run(hook.name) }
          }
          .listStyle(.inset)
          .frame(minHeight: 120)
          HookOutputPane(hook: selectedHook)
            .frame(minHeight: 160)
        }
      }
    } else {
      ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func run(_ name: String) {
    selected = name
    running = name
    Task {
      await workspace.host(
        ArgusProtocol.Commands.GitRunHook.self, .init(id: workspace.sessionId, name: name),
        label: "Running \(name)", track: .hook)
      running = nil
      await load()
    }
  }

  private func load() async {
    switch await GitToolRead.request(
      store, ArgusProtocol.Commands.GitListHooks.self, .init(id: workspace.sessionId))
    {
    case .success(let list):
      hooks = list
      loadError = nil
      if selected == nil || !list.contains(where: { $0.name == selected }) { selected = list.first?.name }
    case .failure(let error):
      loadError = error.message
    }
  }
}

private struct HookRow: View {
  @Environment(\.theme) private var theme
  let hook: ArgusProtocol.GitHook
  let running: Bool
  let run: () -> Void

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "link").foregroundStyle(.secondary)
      VStack(alignment: .leading, spacing: 2) {
        Text(hook.name).font(.system(size: 13, weight: .medium, design: .monospaced))
        Text(meta).font(.system(size: 11)).foregroundStyle(.secondary)
      }
      Spacer()
      if let output = hook.lastOutput {
        Badge(label: "exit \(Int(output.exitCode))", tone: output.exitCode == 0 ? .success : .danger)
      }
      if running {
        ProgressView().controlSize(.small)
      } else {
        Button("Run", action: run).controlSize(.small).disabled(!hook.executable)
      }
    }
    .padding(.vertical, 3)
    .contextMenu {
      Button("Run", action: run).disabled(!hook.executable)
      Button("Copy Path") { Clipboard.copy(hook.path) }
    }
  }

  private var meta: String {
    var parts = [hook.executable ? "executable" : "not executable"]
    if let output = hook.lastOutput {
      let date = Date(timeIntervalSince1970: output.ranAt / 1000)
      parts.append("last run \(date.formatted(.relative(presentation: .named)))")
    }
    return parts.joined(separator: " · ")
  }
}

/// The selected hook's last stdout or stderr.
private struct HookOutputPane: View {
  @Environment(\.theme) private var theme
  let hook: ArgusProtocol.GitHook?
  @State private var stream: Stream = .stdout

  enum Stream: String, CaseIterable, Identifiable {
    case stdout, stderr
    var id: String { rawValue }
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Picker("Output", selection: $stream) {
          ForEach(Stream.allCases) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
        Spacer()
        if let output = hook?.lastOutput {
          Button("Copy") { Clipboard.copy(text(output)) }.buttonStyle(.borderless)
        }
      }
      .padding(.horizontal, 10)
      .frame(height: 34)
      Divider()
      if let output = hook?.lastOutput {
        ScrollView {
          Text(text(output).isEmpty ? "(empty)" : text(output))
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(text(output).isEmpty ? theme.textMuted : theme.text)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
        }
        .background(theme.bgSecondary)
      } else {
        ContentUnavailableView(
          "Not run yet", systemImage: "terminal",
          description: Text(hook == nil ? "Select a hook." : "Run it to see its output here."))
      }
    }
  }

  private func text(_ output: ArgusProtocol.GitHookOutput) -> String {
    stream == .stdout ? output.stdout : output.stderr
  }
}
