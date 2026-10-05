import ArgusCore
import SwiftUI

/// One custom runner: its name, what it's based on, its environment and the
/// models it offers. Credential-looking values stay masked until shown.
struct CustomRunnerEditor: View {
  @Binding var draft: CustomRunnerDraft
  let baseRunners: [ArgusProtocol.RegisteredRunner]
  let saving: Bool
  let error: String?
  let onSave: () -> Void
  let onDelete: () -> Void

  @State private var revealed: Set<UUID> = []

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(draft.displayName.isEmpty ? "New runner" : draft.displayName).font(.scaled(.headline))
        if let id = draft.runnerId {
          Text(id).font(.scaled(.caption).monospaced()).foregroundStyle(.secondary)
        }
        Spacer()
        Button("Remove", action: onDelete)
      }
      Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 8) {
        GridRow {
          Text("Name")
          TextField("Name", text: $draft.displayName, prompt: Text("e.g. Apex")).labelsHidden()
        }
        GridRow {
          Text("Based on")
          Picker("Based on", selection: $draft.baseRunnerId) {
            ForEach(baseRunners, id: \.id) { Text($0.displayName).tag($0.id) }
            if !baseRunners.contains(where: { $0.id == draft.baseRunnerId }) {
              Text(draft.baseRunnerId).tag(draft.baseRunnerId)
            }
          }
          .labelsHidden()
        }
        GridRow {
          Text("Default model")
          TextField("Default model", text: $draft.defaultModel, prompt: Text("e.g. callstack/Apex"))
            .labelsHidden()
            .font(.scaled(.body).monospaced())
        }
      }

      header("Environment") { draft.envRows.append(.init()) }
      ForEach($draft.envRows) { $row in
        HStack {
          TextField("Variable", text: $row.key, prompt: Text("ANTHROPIC_BASE_URL"))
            .labelsHidden()
            .font(.scaled(.body).monospaced())
            .frame(width: 260)
          Group {
            if row.isSecret, !revealed.contains(row.id) {
              SecureField("Value", text: $row.value, prompt: Text("value"))
            } else {
              TextField("Value", text: $row.value, prompt: Text("value"))
            }
          }
          .labelsHidden()
          .font(.scaled(.body).monospaced())
          if row.isSecret {
            Button(revealed.contains(row.id) ? "Hide" : "Show") { toggle(row.id) }
          }
          removeButton("Remove variable") { draft.envRows.removeAll { $0.id == row.id } }
        }
      }

      header("Models") { draft.models.append(.init()) }
      ForEach($draft.models) { $model in
        HStack {
          TextField("Model id", text: $model.modelId, prompt: Text("callstack/Apex"))
            .labelsHidden()
            .font(.scaled(.body).monospaced())
            .frame(width: 260)
          TextField("Label", text: $model.displayName, prompt: Text("Label shown in the picker"))
            .labelsHidden()
          removeButton("Remove model") { draft.models.removeAll { $0.id == model.id } }
        }
      }
      if draft.models.isEmpty {
        SettingsCaption("No models listed — the picker falls back to whatever the base runner advertises.")
      }

      SettingsError(text: error)
      HStack {
        Spacer()
        Button(saving ? "Saving…" : "Save", action: onSave)
          .buttonStyle(.borderedProminent)
          .disabled(saving || !draft.canSave)
      }
    }
    .padding(.vertical, 6)
  }

  private func header(_ title: String, add: @escaping () -> Void) -> some View {
    HStack {
      Text(title).font(.scaled(.subheadline).weight(.semibold))
      Spacer()
      Button(title == "Models" ? "Add Model" : "Add Variable", systemImage: "plus", action: add)
        .buttonStyle(.borderless)
    }
  }

  private func removeButton(_ label: String, action: @escaping () -> Void) -> some View {
    Button(label, systemImage: "xmark.circle.fill", action: action)
      .labelStyle(.iconOnly)
      .buttonStyle(.borderless)
      .help(label)
  }

  private func toggle(_ id: UUID) {
    if revealed.contains(id) { revealed.remove(id) } else { revealed.insert(id) }
  }
}
