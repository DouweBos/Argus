import ArgusCore
import SwiftUI

/// The runner and model new sessions start with, and runners of your own.
struct LLMSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var modelDraft = ""

  var body: some View {
    Form {
      Section {
        if host.loaded {
          VStack(alignment: .leading, spacing: 4) {
            Picker("Runner", selection: runner) {
              ForEach(runnerOptions, id: \.id) { Text($0.label).tag($0.id) }
            }
            .pickerStyle(.radioGroup)
            SettingsCaption("The CLI/agent that drives sessions. The runner is fixed once a session is created.")
          }
          VStack(alignment: .leading, spacing: 4) {
            LabeledContent("Default model") {
              TextField(
                "Default model", text: $modelDraft,
                prompt: Text("e.g. claude-opus-4-7 (leave blank for runner default)")
              )
              .labelsHidden()
              .font(.body.monospaced())
              .onSubmit(saveModel)
            }
            SettingsCaption(
              "Optional. Leave blank to let the runner pick its default model. Project and session "
                + "settings override this.")
          }
        } else {
          SettingsLoading()
        }
      } header: {
        Text("Default LLM")
      } footer: {
        SettingsCaption(
          "Pick the LLM runner and default model used for new sessions. Projects (.argus.json) and "
            + "individual sessions can override these.")
      }

      CustomRunnersSection()

      Section { SettingsError(text: host.error) }
    }
    .formStyle(.grouped)
    .onAppear { modelDraft = host.settings?.defaultLlm?.model ?? "" }
    .onChange(of: host.settings?.defaultLlm?.model) { _, next in modelDraft = next ?? "" }
    .onDisappear(perform: saveModel)
  }

  /// Never empty: Claude Code until the host's list arrives.
  private var runnerOptions: [(id: String, label: String)] {
    host.runners.isEmpty
      ? [("claude-code", "Claude Code")] : host.runners.map { ($0.id, $0.displayName) }
  }

  private var runner: Binding<String> {
    Binding(
      get: { host.settings?.defaultLlm?.runner ?? runnerOptions.first?.id ?? "claude-code" },
      set: { next in save(.runner, runner: next, model: host.settings?.defaultLlm?.model) })
  }

  private func saveModel() {
    let trimmed = modelDraft.trimmingCharacters(in: .whitespacesAndNewlines)
    let model = trimmed.isEmpty ? nil : trimmed
    guard host.loaded, model != host.settings?.defaultLlm?.model else { return }
    save(.llmModel, runner: host.settings?.defaultLlm?.runner ?? "claude-code", model: model)
  }

  private func save(_ field: SettingsField, runner: String, model: String?) {
    let value: JSONValue = .object([
      "runner": .string(runner), "model": model.map(JSONValue.string) ?? .null,
    ])
    Task {
      await host.save(field, ["default_llm": value]) {
        $0.defaultLlm = .init(model: model, runner: runner)
      }
    }
  }
}
