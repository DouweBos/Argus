import ArgusCore
import ArgusUI
import SwiftUI

/// `/skills`: the skills the runners load on this computer, yours then each
/// project's, with Install Skill in the toolbar. `/skills/install` is this
/// screen under the install sheet.
struct SkillsScreen: View {
  @Environment(DesktopModel.self) private var model
  @State private var skills: SkillsModel?
  @State private var installing: Bool
  @State private var removing: ArgusProtocol.Skill?
  private let url: String?

  init(installing: Bool = false, url: String? = nil) {
    _installing = State(initialValue: installing)
    self.url = url
  }

  var body: some View {
    Group {
      if let skills {
        content(skills)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle("Skills")
    .navigationSubtitle(AutomationText.plural(skills?.skills.count ?? 0, "skill"))
    .toolbar {
      ToolbarItem {
        Button { model.navigate(.installSkill()) } label: { Label("Install Skill", systemImage: "plus") }
          .labelStyle(.titleAndIcon)
          .disabled(skills == nil)
      }
    }
    .argusSheet(isPresented: $installing) {
      if let skills { SkillInstallSheet(skills: skills, url: url) }
    }
    // Closing the sheet a link opened leaves its route, so the link works again.
    .onChange(of: installing) { _, open in
      if !open, case .installSkill = model.route { model.navigate(.skills) }
    }
    .confirmationDialog(
      "Remove \(removing?.name ?? "skill")?", isPresented: removingBinding, presenting: removing
    ) { skill in
      Button("Remove", role: .destructive) { Task { await skills?.remove(skill) } }
    } message: { skill in
      Text("Deletes \(skill.path). \(SkillsModel.runnerLabel(skill.runner)) stops loading it.")
    }
    .task(id: ObjectIdentifier(model.store)) {
      if skills?.host !== model.store { skills = SkillsModel(host: model.store) }
      await skills?.refresh()
    }
  }

  private var removingBinding: Binding<Bool> {
    Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
  }

  @ViewBuilder
  private func content(_ skills: SkillsModel) -> some View {
    let phase = skills.phase
    Group {
      switch phase {
      case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      case .failed(let error):
        EmptyState(icon: "exclamationmark.triangle", title: "Skills unavailable", body: error) {
          Button("Try Again") { Task { await skills.refresh() } }
        }
      case .empty:
        EmptyState(
          icon: Icon.skills, title: "No skills yet",
          body:
            "A skill is a folder with a SKILL.md that Claude Code or Codex loads when a task calls for it. "
            + "Install one from a git repository, a gist, a folder or a .skill file."
        ) {
          Button("Install Skill") { model.navigate(.installSkill()) }
        }
      case .content: list(skills)
      }
    }
    .safeAreaInset(edge: .top) {
      if phase.showsContent, let error = skills.error {
        Banner(text: error, tone: .danger).padding([.horizontal, .top])
      } else if let notice = skills.notice {
        Banner(text: notice, tone: .success, onDismiss: { skills.dismissNotice() }).padding([.horizontal, .top])
      }
    }
  }

  private func list(_ skills: SkillsModel) -> some View {
    Form {
      ForEach(skills.sections) { section in
        Section {
          ForEach(section.skills, id: \.path) { skill in
            SkillRow(skill: skill, skills: skills) { removing = skill }
          }
        } header: {
          Text(section.title)
        } footer: {
          if section.id == skills.sections.last?.id {
            Text("Your skills load in every project; a project's are checked in with it.")
          }
        }
      }
    }
    .formStyle(.grouped)
  }
}

private struct SkillRow: View {
  @Environment(\.theme) private var theme
  let skill: ArgusProtocol.Skill
  let skills: SkillsModel
  let onRemove: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: Icon.skills)
        .font(.scaled(size: 15))
        .foregroundStyle(theme.accent)
        .frame(width: 30, height: 30)
        .background(theme.accent.opacity(0.12), in: .rect(cornerRadius: 7))
      VStack(alignment: .leading, spacing: 2) {
        Text(skill.name).fontWeight(.medium)
        Text(SkillsModel.detail(skill)).font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(2)
        if let source = SkillsModel.sourceLabel(skill.source) {
          Label(source, systemImage: sourceIcon)
            .font(.scaled(.caption2)).foregroundStyle(theme.textMuted).lineLimit(1)
            .help(skill.source?.location ?? "")
        }
      }
      Spacer(minLength: 8)
      Badge(label: SkillsModel.runnerLabel(skill.runner)).fixedSize()
      if skills.busy.contains(skill.path) {
        ProgressView().controlSize(.small)
      } else {
        Menu {
          actions
        } label: {
          Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .clickable()
        .accessibilityLabel("Actions for \(skill.name)")
      }
    }
    .padding(.vertical, 2)
    .contextMenu { actions }
  }

  private var sourceIcon: String {
    switch skill.source?.kind {
    case .git, .gist: "link"
    case .archive: "doc.zipper"
    default: "folder"
    }
  }

  @ViewBuilder
  private var actions: some View {
    Button("Update") { Task { await skills.update(skill) } }
      .disabled(!SkillsModel.canUpdate(skill))
    Button("Copy Path") {
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(skill.path, forType: .string)
    }
    Divider()
    Button("Remove", role: .destructive, action: onRemove)
  }
}
