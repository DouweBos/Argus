import ArgusCore
import ArgusUI
import SwiftUI

/// `/skills`: the skills the runners load on the computer, yours then each
/// project's. Installing, updating and removing need control; installing from
/// a folder or a file is the Mac's, which can pick them.
struct SkillsView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @State private var model: SkillsModel?
  @State private var removing: ArgusProtocol.Skill?

  var body: some View {
    let phase = model?.phase ?? .loading
    List {
      if let model, phase.showsContent {
        if let error = model.error {
          Banner(text: error, tone: .danger).listRowBackground(Color.clear)
        } else if let notice = model.notice {
          Banner(text: notice, tone: .success, onDismiss: { model.dismissNotice() }).listRowBackground(Color.clear)
        }
        ForEach(model.sections) { section in
          Section(section.title) {
            ForEach(section.skills, id: \.path) { skill in
              SkillRowView(skill: skill, model: model, control: host.hasControl) { removing = skill }
            }
          }
        }
      }
    }
    .loadPhase(
      phase, loading: "Reading skills", failedTitle: "Skills unavailable", retry: { await model?.refresh() }
    ) {
      EmptyState(
        icon: Icon.skills, title: "No skills yet",
        body: "A skill is a folder with a SKILL.md that Claude Code or Codex loads when a task calls for it."
      ) {
        if host.hasControl {
          Btn(label: "Install Skill", icon: Icon.plus, hugs: true) { router.push(.installSkill(url: nil)) }
        }
      }
    }
    .navigationTitle("Skills")
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink(value: Route.installSkill(url: nil)) {
            Label("Install Skill", systemImage: Icon.plus)
          }
        }
      }
    }
    .confirmationDialog(
      "Remove \(removing?.name ?? "skill")?", isPresented: removingBinding, titleVisibility: .visible,
      presenting: removing
    ) { skill in
      Button("Remove", role: .destructive) { Task { await model?.remove(skill) } }
    } message: { skill in
      Text("Deletes its folder on the computer. \(SkillsModel.runnerLabel(skill.runner)) stops loading it.")
    }
    .refreshable { await model?.refresh() }
    .task(id: ObjectIdentifier(host)) {
      if model?.host !== host { model = SkillsModel(host: host) }
      await model?.refresh()
    }
  }

  private var removingBinding: Binding<Bool> {
    Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
  }
}

private struct SkillRowView: View {
  @Environment(\.theme) private var theme
  let skill: ArgusProtocol.Skill
  let model: SkillsModel
  let control: Bool
  let onRemove: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: Icon.skills)
        .font(.scaled(size: 15))
        .foregroundStyle(theme.accent)
        .frame(width: 30, height: 30)
        .background(theme.accent.opacity(0.12), in: .rect(cornerRadius: 7))
      VStack(alignment: .leading, spacing: 2) {
        Text(skill.name).font(.scaled(size: 15, weight: .medium)).foregroundStyle(theme.text)
        Text(SkillsModel.detail(skill)).font(.scaled(size: 13)).foregroundStyle(theme.textSecondary).lineLimit(2)
        HStack(spacing: 6) {
          Text(SkillsModel.runnerLabel(skill.runner))
          if let source = SkillsModel.sourceLabel(skill.source) {
            Text("·")
            Text(source).lineLimit(1)
          }
        }
        .font(.scaled(size: 12)).foregroundStyle(theme.textMuted)
      }
      Spacer(minLength: 6)
      if model.busy.contains(skill.path) {
        ProgressView()
      } else if control {
        Menu {
          actions
        } label: {
          Image(systemName: Icon.more)
            .font(.scaled(size: 17))
            .foregroundStyle(theme.accent)
            .frame(width: 36, height: 36)
            .contentShape(.rect)
        }
        .accessibilityLabel("Actions for \(skill.name)")
      }
    }
    .contextMenu { if control { actions } }
    .swipeActions {
      if control { Button("Remove", role: .destructive, action: onRemove) }
    }
  }

  @ViewBuilder
  private var actions: some View {
    Button { Task { await model.update(skill) } } label: { Label("Update", systemImage: Icon.refresh) }
      .disabled(!SkillsModel.canUpdate(skill))
    Button(role: .destructive, action: onRemove) { Label("Remove", systemImage: Icon.trash) }
  }
}
