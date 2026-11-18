import ArgusUI
import SwiftUI

/// `/blueprints/generate`: pick projects, and Claude reads them and drafts a
/// blueprint, which opens in the editor for review. Nothing is saved until Save.
///
/// Needs control: drafting spends the computer's Claude account.
struct GenerateBlueprintView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(BlueprintsStore.self) private var store

  @State private var picked: [String]
  @State private var working: Bool

  init(picked: [String] = [], drafting: Bool = false) {
    _picked = State(initialValue: picked)
    _working = State(initialValue: drafting)
  }

  private var drafting: Bool { working || store.drafting }

  var body: some View {
    List {
      if let error = store.error, !drafting {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }
      if drafting {
        Section {
          VStack(alignment: .leading, spacing: 6) {
            Loading(label: "Claude is reading \(AutomationText.plural(picked.count, "project"))")
            MutedText("This takes a minute or two. The draft opens for review when it's ready.")
          }
          .padding(.vertical, 4)
        }
      }
      Section {
        ForEach(host.projects) { project in
          row(project)
        }
      } header: {
        header
      } footer: {
        Text("Claude looks at what these have in common: layout, tooling, release setup and settings.")
      }
      .disabled(drafting)
    }
    .emptyState(when: host.projectsLoaded && host.projects.isEmpty) {
      EmptyState(
        icon: Icon.folder, title: "No projects",
        body: "Open a repository in Argus on the computer to draft a blueprint from it.")
    }
    .navigationTitle("Generate Blueprint")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button(drafting ? "Drafting" : "Draft") { draft() }
          .disabled(drafting || picked.isEmpty || !host.hasControl)
      }
    }
    .reportsBlueprintScreen(.generate)
  }

  private func row(_ project: RemoteProject) -> some View {
    let on = picked.contains(project.repoRoot)
    return Button {
      if on { picked.removeAll { $0 == project.repoRoot } } else { picked.append(project.repoRoot) }
    } label: {
      HStack(spacing: 12) {
        Image(systemName: Icon.folder)
          .font(.scaled(size: 15))
          .foregroundStyle(theme.textSecondary)
          .frame(width: 22)
        Text(project.name).foregroundStyle(theme.text).lineLimit(1)
        Spacer(minLength: 6)
        Image(systemName: on ? "checkmark.circle.fill" : "circle")
          .font(.scaled(size: 19))
          .foregroundStyle(on ? theme.accent : theme.textMuted)
      }
      .contentShape(.rect)
    }
    .buttonStyle(.argusPlain)
    .accessibilityAddTraits(on ? .isSelected : [])
  }

  private var header: some View {
    let all = host.projects.map(\.repoRoot)
    let everything = !all.isEmpty && all.allSatisfy(picked.contains)
    return HStack(spacing: 8) {
      Text("Projects")
      Spacer(minLength: 6)
      if all.count > 1 {
        Button(everything ? "Clear" : "Select All") {
          picked = everything ? [] : all
        }
        .font(.scaled(.footnote))
        .textCase(nil)
        .disabled(drafting)
      }
      Text("\(picked.count) of \(all.count)").monospacedDigit().textCase(nil)
    }
  }

  private func draft() {
    working = true
    let paths = picked
    Task {
      let drafted = await store.draft(paths: paths)
      working = false
      // Only while this screen is still in front; the draft waits in the store otherwise.
      guard drafted, router.frontRoute == .generateBlueprint else { return }
      router.replaceTop(with: .blueprint(id: nil), dropping: 1)
    }
  }
}
