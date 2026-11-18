import ArgusCore
import ArgusUI
import SwiftUI

/// `/blueprints`: this computer's recipes for new projects, one row each with
/// New Project beside it. `/blueprints/new-project` is this screen under the sheet.
struct BlueprintsScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(BlueprintsStore.self) private var store
  @State private var creatingProject: Bool
  private let blueprintId: String?

  init(newProject: Bool = false, blueprintId: String? = nil) {
    _creatingProject = State(initialValue: newProject)
    self.blueprintId = blueprintId
  }

  var body: some View {
    let phase = store.phase
    Group {
      switch phase {
      case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      case .failed(let error):
        EmptyState(icon: "exclamationmark.triangle", title: "Blueprints unavailable", body: error) {
          Button("Try Again") { Task { await store.refresh() } }
        }
      case .empty: empty
      case .content: list
      }
    }
    .safeAreaInset(edge: .top) {
      if phase.showsContent, let error = store.error {
        Banner(text: error, tone: .danger).padding([.horizontal, .top])
      }
    }
    .navigationTitle("Blueprints")
    .navigationSubtitle(AutomationText.plural(store.blueprints.count, "blueprint"))
    .toolbar {
      ToolbarItemGroup {
        Button { model.navigate(.generateBlueprint) } label: {
          Label("Generate from Projects", systemImage: Icon.draft)
        }
        .labelStyle(.titleAndIcon)
        Button { model.navigate(.blueprint(id: nil)) } label: { Label("New Blueprint", systemImage: "plus") }
          .labelStyle(.titleAndIcon)
      }
    }
    .sheet(isPresented: $creatingProject) { NewProjectSheet(blueprintId: blueprintId) }
    // Closing the sheet a link opened leaves its route, so the link works again.
    .onChange(of: creatingProject) { _, open in
      if !open, case .newProject = model.route { model.navigate(.blueprints) }
    }
    .task { await store.refresh() }
  }

  private var empty: some View {
    EmptyState(
      icon: BlueprintText.icon, title: "No blueprints yet",
      body:
        "A blueprint is how you start a project: where it lives, which projects to borrow from, "
        + "the GitHub repository and what the first agent does. Let Claude draft one from projects you have."
    ) {
      Button("Generate from Projects") { model.navigate(.generateBlueprint) }
      Button("New Blueprint") { model.navigate(.blueprint(id: nil)) }
    }
  }

  private var list: some View {
    Form {
      Section {
        ForEach(store.blueprints, id: \.id) { BlueprintRow(blueprint: $0) }
      } footer: {
        Text("New Project creates the folder and repository, adds it to Argus and starts an agent on it.")
      }
    }
    .formStyle(.grouped)
  }
}

private struct BlueprintRow: View {
  @Environment(DesktopModel.self) private var model
  @Environment(BlueprintsStore.self) private var store
  @Environment(\.theme) private var theme
  let blueprint: ArgusProtocol.Blueprint

  var body: some View {
    HStack(spacing: 12) {
      Button { model.navigate(.blueprint(id: blueprint.id)) } label: {
        HStack(spacing: 12) {
          Image(systemName: BlueprintText.icon)
            .font(.scaled(size: 15))
            .foregroundStyle(theme.accent)
            .frame(width: 30, height: 30)
            .background(theme.accent.opacity(0.12), in: .rect(cornerRadius: 7))
          VStack(alignment: .leading, spacing: 2) {
            Text(blueprint.name).fontWeight(.medium)
            Text(detail).font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1)
          }
          Spacer(minLength: 8)
          lastRun
        }
        .contentShape(.rect)
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel(blueprint.name)
      Button("New Project") { model.navigate(.newProject(blueprintId: blueprint.id)) }
    }
    .padding(.vertical, 2)
    .contextMenu {
      Button("Open") { model.navigate(.blueprint(id: blueprint.id)) }
      Button("New Project") { model.navigate(.newProject(blueprintId: blueprint.id)) }
    }
  }

  private var detail: String {
    let references = BlueprintText.references(blueprint.references.count)
    return blueprint.summary.isEmpty ? references : "\(blueprint.summary) · \(references)"
  }

  @ViewBuilder
  private var lastRun: some View {
    if let latest = store.runs(for: blueprint.id).first {
      HStack(spacing: 6) {
        Text(latest.projectName).foregroundStyle(.secondary).lineLimit(1)
        Badge(label: BlueprintText.label(latest.status), tone: BlueprintText.tone(latest.status)).fixedSize()
      }
      .font(.scaled(.caption))
      .help("Last project made from this blueprint, \(Labels.timeAgo(latest.startedAt))")
    }
  }
}
