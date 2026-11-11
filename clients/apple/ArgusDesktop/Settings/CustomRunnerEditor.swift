import ArgusCore
import SwiftUI

/// One custom runner: its name, what it's based on (or the ACP agent it starts),
/// its environment and the models it offers. Credential-looking values stay
/// masked until shown.
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
            Text("ACP agent (own command)").tag(CustomRunnerDraft.acpBaseId)
            if !draft.isAcp, !baseRunners.contains(where: { $0.id == draft.baseRunnerId }) {
              Text(draft.baseRunnerId).tag(draft.baseRunnerId)
            }
          }
          .labelsHidden()
        }
        if draft.isAcp {
          acpRows
        }
        GridRow {
          Text("Default model")
          TextField("Default model", text: $draft.defaultModel, prompt: Text(draft.isAcp ? "Leave blank for the agent's own" : "e.g. callstack/Apex"))
            .labelsHidden()
            .font(.scaled(.body).monospaced())
        }
      }

      header("Environment") { draft.envRows.append(.init()) }
      ForEach($draft.envRows) { $row in
        HStack {
          TextField("Variable", text: $row.key, prompt: Text(draft.isAcp ? "API_KEY" : "ANTHROPIC_BASE_URL"))
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
        SettingsCaption(
          draft.isAcp
            ? "No models listed — the agent offers its own once a chat starts."
            : "No models listed — the picker falls back to whatever the base runner advertises.")
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

  @ViewBuilder private var acpRows: some View {
    GridRow {
      Text("Command")
      TextField("Command", text: $draft.acpCommand, prompt: Text("e.g. goose, or an absolute path"))
        .labelsHidden()
        .font(.scaled(.body).monospaced())
    }
    GridRow {
      Text("Arguments")
      TextField("Arguments", text: $draft.acpArgs, prompt: Text("e.g. acp"))
        .labelsHidden()
        .font(.scaled(.body).monospaced())
    }
    GridRow {
      Text("Install hint")
      TextField("Install hint", text: $draft.installHint, prompt: Text("Shown when the command isn't found"))
        .labelsHidden()
    }
    GridRow {
      Text("Sign-in hint")
      TextField("Sign-in hint", text: $draft.loginHint, prompt: Text("Shown when the agent isn't signed in"))
        .labelsHidden()
    }
  }

  private func header(_ title: String, add: @escaping () -> Void) -> some View {
    HStack {
      Text(title).font(.scaled(.subheadline).weight(.semibold))
      Spacer()
      Button(title == "Models" ? "Add Model" : "Add Variable", systemImage: "plus", action: add)
        .buttonStyle(.argusBorderless)
    }
  }

  private func removeButton(_ label: String, action: @escaping () -> Void) -> some View {
    Button(label, systemImage: "xmark.circle.fill", action: action)
      .labelStyle(.iconOnly)
      .buttonStyle(.argusBorderless)
      .help(label)
  }

  private func toggle(_ id: UUID) {
    if revealed.contains(id) { revealed.remove(id) } else { revealed.insert(id) }
  }
}
