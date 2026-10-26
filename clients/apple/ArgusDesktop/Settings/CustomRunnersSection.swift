import ArgusCore
import ArgusUI
import SwiftUI

/// An official runner re-pointed at another endpoint through its environment.
/// Drafts stay here until saved, so a half-typed token never reaches disk.
struct CustomRunnersSection: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var drafts: [CustomRunnerDraft] = []
  @State private var presets: [ArgusProtocol.CustomRunnerPreset] = []
  @State private var saving: UUID?
  @State private var errors: [UUID: String] = [:]

  var body: some View {
    SettingsGroup(
      "Custom runners",
      footer: "Point an official runner at a different endpoint — a gateway like callstack.ai's Apex, a "
        + "proxy, or a self-hosted model. Custom runners reuse the base runner's CLI and only "
        + "override its environment and model list. Stored in ~/.argus/custom-runners.json; pick "
        + "one per session in the runner picker or as the app default above."
    ) {
      if drafts.isEmpty {
        Text("No custom runners yet. Start from a template above.").foregroundStyle(.secondary)
      }
      ForEach($drafts) { $draft in
        CustomRunnerEditor(
          draft: $draft, baseRunners: host.runners.filter { !$0.isCustom },
          saving: saving == draft.id, error: errors[draft.id]
        ) {
          save(draft)
        } onDelete: {
          delete(draft)
        }
      }
    } accessory: {
      HStack(spacing: 6) {
        ForEach(presets, id: \.key) { preset in
          SettingsHeaderButton(preset.label, systemImage: "plus") {
            drafts.append(CustomRunnerDraft(preset: preset.draft))
          }
          .help(preset.description)
        }
      }
    }
    .task(id: host.loaded) {
      drafts = (await host.run(ArgusProtocol.Commands.LlmListCustomRunners.self, EmptyParams()) ?? [])
        .map(CustomRunnerDraft.init)
      presets = await host.run(ArgusProtocol.Commands.LlmListCustomRunnerPresets.self, EmptyParams()) ?? []
    }
  }

  private func save(_ draft: CustomRunnerDraft) {
    saving = draft.id
    errors[draft.id] = nil
    Task {
      defer { saving = nil }
      guard let backend = host.backend else { return }
      do {
        let saved = try await backend.request(
          ArgusProtocol.Commands.LlmSaveCustomRunner.self, .init(runner: draft.wire))
        if let index = drafts.firstIndex(where: { $0.id == draft.id }) {
          drafts[index].runnerId = saved.id
        }
        MacTelemetry.capture(.settingsChanged(setting: .customRunnerSaved))
        await host.loadRunners()
      } catch {
        errors[draft.id] = HostStore.describe(error)
      }
    }
  }

  private func delete(_ draft: CustomRunnerDraft) {
    drafts.removeAll { $0.id == draft.id }
    guard let runnerId = draft.runnerId else { return }
    Task {
      await host.run(ArgusProtocol.Commands.LlmDeleteCustomRunner.self, .init(id: runnerId))
      MacTelemetry.capture(.settingsChanged(setting: .customRunnerDeleted))
      await host.loadRunners()
    }
  }
}
