import ArgusCore
import ArgusUI
import SwiftUI

/// `/skills/install`: install a skill from a git URL or a gist onto the
/// computer. A folder or a `.skill` file is a path on the computer, so those
/// install from the Mac. Needs control.
struct SkillInstallView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  private let url: String?
  @State private var install: SkillInstallModel?

  init(url: String? = nil, install: SkillInstallModel? = nil) {
    self.url = url
    _install = State(initialValue: install)
  }

  var body: some View {
    Group {
      if let install {
        SkillInstallForm(install: install)
      } else {
        Loading(label: "Reading projects")
      }
    }
    .navigationTitle("Install Skill")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if let install, host.hasControl {
        ToolbarItem(placement: .confirmationAction) {
          Button(label(install)) {
            Task { if await install.install(overwrite: install.conflict != nil) { router.pop() } }
          }
          .disabled(!install.canInstall)
        }
      }
    }
    .task(id: ObjectIdentifier(host)) {
      if install?.skills.host !== host { install = SkillInstallModel(skills: SkillsModel(host: host), url: url) }
      if host.projects.isEmpty { await host.refreshProjects() }
    }
  }

  private func label(_ install: SkillInstallModel) -> String {
    if install.installing { return "Installing" }
    return install.conflict == nil ? "Install" : "Replace"
  }
}

private struct SkillInstallForm: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Bindable var install: SkillInstallModel

  var body: some View {
    List {
      if let name = install.conflict {
        Banner(
          text: "A skill named \(name) is already installed there. Replace deletes its files first.", tone: .warning
        )
        .listRowBackground(Color.clear)
      } else if let error = install.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }
      Section {
        TextField("URL", text: $install.location, prompt: prompt("https://github.com/owner/skills"))
          .font(.scaled(size: 15, design: .monospaced))
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
        TextField("Path", text: $install.subpath, prompt: prompt("Folder inside the repository, optional"))
          .font(.scaled(size: 15, design: .monospaced))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      } header: {
        Text("From")
      } footer: {
        Text(SkillInstallModel.urlHint + " A folder or a .skill file installs from the Mac.")
      }
      Section {
        Picker("For", selection: $install.scope) {
          Text("Every project").tag(ArgusProtocol.SkillScope.user)
          Text("One project").tag(ArgusProtocol.SkillScope.project)
        }
        if install.scope == .project {
          Picker("Project", selection: $install.repoRoot) {
            Text("Choose").tag(String?.none)
            ForEach(install.projects) { Text($0.name).tag(String?.some($0.repoRoot)) }
          }
        }
        Picker("Runner", selection: $install.runner) {
          Text(SkillsModel.runnerLabel(.claudeCode)).tag(ArgusProtocol.SkillRunner.claudeCode)
          Text(SkillsModel.runnerLabel(.codex)).tag(ArgusProtocol.SkillRunner.codex)
        }
      } header: {
        Text("Install into")
      } footer: {
        Text(install.destinationHint)
      }
    }
    .scrollDismissesKeyboard(.interactively)
    .disabled(!host.hasControl || install.installing)
  }

  private func prompt(_ text: String) -> Text {
    Text(text).foregroundStyle(theme.textMuted)
  }
}
