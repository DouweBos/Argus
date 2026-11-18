import ArgusUI
import SwiftUI

/// `/blueprints`: the computer's recipes for new projects, each one a tap from
/// a new project. Writing or generating one needs control.
struct BlueprintsView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(BlueprintsStore.self) private var store

  var body: some View {
    List {
      if store.phase.showsContent {
        if let error = store.error {
          Banner(text: error, tone: .danger).listRowBackground(Color.clear)
        }
        draftStatus
        Section {
          ForEach(store.blueprints, id: \.id) { blueprint in
            NavigationLink(value: Route.blueprint(id: blueprint.id)) {
              HStack(spacing: 8) {
                BlueprintRow(blueprint: blueprint)
                Spacer(minLength: 6)
                if host.hasControl {
                  Button {
                    router.push(.newProject(blueprintId: blueprint.id))
                  } label: {
                    Image(systemName: BlueprintSymbol.newProject)
                      .font(.scaled(size: 17))
                      .foregroundStyle(theme.accent)
                      .frame(width: 36, height: 36)
                      .contentShape(.rect)
                  }
                  .buttonStyle(.argusBorderless)
                  .accessibilityLabel("New project from \(blueprint.name)")
                }
              }
            }
          }
        }
      }
    }
    .loadPhase(
      store.phase, loading: "Reading blueprints", failedTitle: "Blueprints unavailable",
      retry: { await store.refresh() }
    ) {
      EmptyState(
        icon: BlueprintSymbol.blueprint,
        title: "No blueprints",
        body: "A blueprint is a recipe for a new project: where it goes, which projects it copies from, "
          + "and what the first agent does."
      ) {
        if host.hasControl {
          Btn(label: "Generate from Projects", icon: Icon.draft, hugs: true) {
            router.push(.generateBlueprint)
          }
          Btn(label: "New Blueprint", tone: .secondary, icon: Icon.plus, hugs: true) {
            router.push(.blueprint(id: nil))
          }
        }
      }
    }
    .navigationTitle("Blueprints")
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            NavigationLink(value: Route.blueprint(id: nil)) {
              Label("New Blueprint", systemImage: Icon.plus)
            }
            NavigationLink(value: Route.generateBlueprint) {
              Label("Generate from Projects", systemImage: Icon.draft)
            }
          } label: {
            Label("New", systemImage: Icon.plus)
          }
        }
      }
    }
    .refreshable { await store.refresh() }
    .liveRefresh(enabled: host.connection == .ready) { await store.refresh() }
    .reportsBlueprintScreen(.list)
  }

  /// A draft started on the generate screen keeps going after leaving it.
  @ViewBuilder
  private var draftStatus: some View {
    if store.drafting {
      Loading(label: "Drafting a blueprint").listRowBackground(Color.clear)
    } else if store.pendingDraft != nil, host.hasControl {
      Banner(
        text: "Claude finished drafting a blueprint.", tone: .accent, actionLabel: "Review",
        action: { router.push(.blueprint(id: nil)) }
      )
      .listRowBackground(Color.clear)
    }
  }
}
