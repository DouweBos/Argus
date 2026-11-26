import AppKit
import ArgusCore
import ArgusUI
import SwiftUI
import UniformTypeIdentifiers

/// Install Skill: from a URL, a folder or a `.skill` file, into your skills or
/// a project's, for Claude Code or Codex. Asks before replacing one.
struct SkillInstallSheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var install: SkillInstallModel

  init(skills: SkillsModel, url: String? = nil) {
    self.init(install: SkillInstallModel(skills: skills, url: url))
  }

  init(install: SkillInstallModel) {
    _install = State(initialValue: install)
  }

  var body: some View {
    VStack(spacing: 0) {
      Text("Install Skill").font(.scaled(.title2).weight(.semibold))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding([.horizontal, .top], 24)
      Form {
        SkillInstallSourceFields(install: install, local: model.hosts.focused == Hosts.local)
        SkillInstallTargetFields(install: install)
        if let name = install.conflict {
          Section {
            Label(
              "A skill named \(name) is already installed there. Replace deletes its files first.",
              systemImage: "exclamationmark.triangle.fill"
            )
            .foregroundStyle(theme.warning)
          }
        } else if let error = install.error {
          Section { Text(error).foregroundStyle(theme.error).textSelection(.enabled) }
        }
      }
      .formStyle(.grouped)
      HStack {
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Spacer()
        Button(primaryLabel) {
          Task { if await install.install(overwrite: install.conflict != nil) { dismiss() } }
        }
        .keyboardShortcut(.defaultAction)
        .disabled(!install.canInstall)
      }
      .padding()
    }
    .frame(width: 560, height: 540)
  }

  private var primaryLabel: String {
    if install.installing { return "Installing" }
    return install.conflict == nil ? "Install" : "Replace"
  }
}

/// Where the skill comes from. A file can only be picked on this Mac; a folder
/// is browsed on whichever computer is connected.
private struct SkillInstallSourceFields: View {
  @Environment(DesktopModel.self) private var model
  @Bindable var install: SkillInstallModel
  let local: Bool

  var body: some View {
    Section {
      Picker("From", selection: $install.from) {
        ForEach(SkillInstallModel.From.allCases, id: \.self) { from in
          Text(from.label).tag(from)
        }
      }
      .pickerStyle(.segmented)
      .onChange(of: install.from) { install.location = "" }
      switch install.from {
      case .url:
        TextField("URL", text: $install.location, prompt: Text("https://github.com/owner/skills/tree/main/review"))
          .font(.system(.body, design: .monospaced))
        TextField("Path", text: $install.subpath, prompt: Text("Folder inside the repository, optional"))
          .font(.system(.body, design: .monospaced))
      case .folder:
        picked("Folder", empty: "No folder chosen") {
          if let path = await model.pickFolder(prompt: "Install") { install.location = path }
        }
      case .archive:
        picked("File", empty: local ? "No file chosen" : "Only on this Mac") {
          if let url = await SkillPanels.chooseArchive() { install.location = url.path }
        }
        .disabled(!local)
      }
    } footer: {
      Text(hint)
    }
  }

  private func picked(_ title: String, empty: String, choose: @escaping () async -> Void) -> some View {
    LabeledContent(title) {
      HStack(spacing: 6) {
        Text(install.location.isEmpty ? empty : install.location)
          .foregroundStyle(install.location.isEmpty ? .secondary : .primary)
          .lineLimit(1).truncationMode(.middle)
        Button("Choose") { Task { await choose() } }
      }
    }
  }

  private var hint: String {
    switch install.from {
    case .url: SkillInstallModel.urlHint
    case .folder: "A folder holding a SKILL.md, or a folder of skills with one picked by name."
    case .archive: "A .skill or .zip file holding a SKILL.md."
    }
  }
}

/// Which skills folder it lands in.
private struct SkillInstallTargetFields: View {
  @Bindable var install: SkillInstallModel

  var body: some View {
    Section {
      Picker("For", selection: $install.scope) {
        Text("Every project").tag(ArgusProtocol.SkillScope.user)
        Text("One project").tag(ArgusProtocol.SkillScope.project)
      }
      if install.scope == .project {
        Picker("Project", selection: $install.repoRoot) {
          Text("Choose a project").tag(String?.none)
          ForEach(install.projects) { Text($0.name).tag(String?.some($0.repoRoot)) }
        }
      }
      Picker("Runner", selection: $install.runner) {
        Text(SkillsModel.runnerLabel(.claudeCode)).tag(ArgusProtocol.SkillRunner.claudeCode)
        Text(SkillsModel.runnerLabel(.codex)).tag(ArgusProtocol.SkillRunner.codex)
      }
    } footer: {
      Text(install.destinationHint)
    }
  }
}

@MainActor
enum SkillPanels {
  static func chooseArchive() async -> URL? {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = false
    panel.canChooseDirectories = false
    panel.allowedContentTypes = [UTType(filenameExtension: "skill"), .zip].compactMap { $0 }
    panel.message = "Choose a .skill or .zip file to install"
    return await withCheckedContinuation { done in
      if let window = NSApp.keyWindow {
        panel.beginSheetModal(for: window) { done.resume(returning: $0 == .OK ? panel.url : nil) }
      } else {
        done.resume(returning: panel.runModal() == .OK ? panel.url : nil)
      }
    }
  }
}
