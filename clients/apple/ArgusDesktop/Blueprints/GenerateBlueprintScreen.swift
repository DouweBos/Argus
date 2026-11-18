import ArgusCore
import ArgusUI
import SwiftUI

/// `/blueprints/generate`: pick projects, and Claude drafts a blueprint from
/// what they share. The draft opens in the editor, unsaved.
struct GenerateBlueprintScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(BlueprintsStore.self) private var store
  @Environment(\.theme) private var theme
  @State private var selection: [String]
  /// The gallery shows the progress state without a draft in flight.
  private let showsDrafting: Bool

  init(selection: [String] = [], drafting: Bool = false) {
    _selection = State(initialValue: selection)
    showsDrafting = drafting
  }

  private var drafting: Bool { showsDrafting || store.drafting }

  var body: some View {
    Group {
      if drafting {
        progress
      } else {
        Form {
          if let error = store.error {
            Section { Banner(text: error, tone: .danger) }
          }
          ProjectScopeSection(
            selection: $selection,
            footer: "Claude reads these projects and drafts a blueprint from what they have in common. "
              + "One project works too.")
        }
        .formStyle(.grouped)
        .toggleStyle(.checkbox)
      }
    }
    .navigationTitle("Generate Blueprint")
    .toolbar {
      ToolbarItemGroup {
        Button { BlueprintActions.generate(model, paths: selection) } label: {
          Label("Generate", systemImage: Icon.draft)
        }
        .labelStyle(.titleAndIcon)
        .disabled(drafting || selection.isEmpty)
      }
    }
  }

  private var progress: some View {
    VStack(spacing: 14) {
      ProgressView().controlSize(.large)
      Text("Reading your projects").font(.scaled(.title3).weight(.semibold))
      Text("Claude is looking at their layout, tooling and workflows. This takes a minute or two.")
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .frame(maxWidth: 380)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
