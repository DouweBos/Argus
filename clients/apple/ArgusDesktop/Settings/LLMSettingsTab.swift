import ArgusCore
import ArgusUI
import SwiftUI

/// The runner and model new sessions start with, and runners of your own.
struct LLMSettingsTab: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var modelDraft = ""

  var body: some View {
    SettingsPage {
      SettingsGroup(
        "Default LLM",
        footer: "Pick the LLM runner and default model used for new sessions. Projects (.argus.json) and "
          + "individual sessions can override these."
      ) {
        if host.loaded {
          SettingsRow(
            "Runner", description: runnerDescription
          ) {
            Picker("Runner", selection: runner) {
              ForEach(runnerOptions, id: \.id) { option in
                Text(option.label).tag(option.id).disabled(!option.available)
              }
            }
          }
          SettingsRow(
            "Default model",
            description: "Optional. Leave blank to let the runner pick its default model. Project and session "
              + "settings override this."
          ) {
            TextField("Default model", text: $modelDraft, prompt: Text("e.g. claude-opus-4-7"))
              .textFieldStyle(.roundedBorder)
              .font(.scaled(.body).monospaced())
              .frame(width: 240)
              .onSubmit(saveModel)
          }
        } else {
          SettingsLoading()
        }
      }

      CustomRunnersSection()

      SettingsError(text: host.error)
    }
    .onAppear { modelDraft = host.settings?.defaultLlm?.model ?? "" }
    .onChange(of: host.settings?.defaultLlm?.model) { _, next in modelDraft = next ?? "" }
    .onDisappear(perform: saveModel)
  }

  /// Never empty: Claude Code until the host's list arrives.
  private var runnerOptions: [(id: String, label: String, available: Bool)] {
    host.runners.isEmpty
      ? [("claude-code", "Claude Code", true)]
      : host.runners.map {
        ($0.id, $0.isAvailable ? $0.displayName : "\($0.displayName) (not installed)", $0.isAvailable)
      }
  }

  /// A picked runner whose CLI went missing says how to install it.
  private var runnerDescription: String {
    let picked = host.runners.first { $0.id == runner.wrappedValue }
    if let picked, !picked.isAvailable, let reason = picked.unavailableReason { return reason }
    return "The CLI/agent that drives sessions. The runner is fixed once a session is created."
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
