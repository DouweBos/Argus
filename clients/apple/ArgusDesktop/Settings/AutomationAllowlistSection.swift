import ArgusCore
import SwiftUI

/// What a read-only automation may additionally do, and what it was refused
/// while trying. A refusal becomes an allowlist entry only by your click.
struct AutomationAllowlistSection: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var refusals: [ArgusProtocol.GateLogEntry] = []
  @State private var draft = ""

  var body: some View {
    Section {
      if let settings = host.settings {
        VStack(alignment: .leading, spacing: 6) {
          Text("Extra commands for read-only runs")
          EntryList(entries: settings.automationAllowedCommands ?? []) { remove(.command, $0) }
          HStack {
            TextField("Command", text: $draft, prompt: Text("conductor screenshot"))
              .labelsHidden()
              .font(.body.monospaced())
              .onSubmit(addDraft)
            Button("Add", action: addDraft)
              .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
          }
          SettingsCaption(
            "A read-only automation may only run commands that observe. Add a command, or a prefix "
              + "like `gh pr list`, to widen that. Projects cannot add to this — it is yours.")
        }
        if let tools = settings.automationAllowedTools, !tools.isEmpty {
          VStack(alignment: .leading, spacing: 6) {
            Text("Extra tools for read-only runs")
            EntryList(entries: tools) { remove(.tool, $0) }
            SettingsCaption("Tools promoted from a refusal below.")
          }
        }
      } else {
        SettingsLoading()
      }
    } header: {
      Text("Read-only runs")
    }

    Section {
      ForEach(refusals, id: \.id) { entry in
        RefusalRow(entry: entry) {
          add(entry.kind, entry.suggestedEntry, field: .refusalAllowed)
          dismiss(entry, field: nil)
        } onDismiss: {
          dismiss(entry, field: .refusalDismissed)
        }
      }
      if !refusals.isEmpty {
        Button("Clear All") {
          Task {
            await host.run(ArgusProtocol.Commands.AutomationGateLogClear.self, EmptyParams())
            await loadRefusals()
          }
        }
      }
    } header: {
      Text("Refused while running")
    } footer: {
      SettingsCaption(
        refusals.isEmpty
          ? "Nothing has been turned away. Anything a read-only run is refused shows up here to allow or ignore."
          : "A read-only run tried these and was refused. Allow the ones that only read.")
    }
    .task { await loadRefusals() }
  }

  private func loadRefusals() async {
    refusals = await host.run(ArgusProtocol.Commands.AutomationGateLogList.self, EmptyParams()) ?? []
  }

  private func addDraft() {
    add(.command, draft, field: .allowedCommands)
    draft = ""
  }

  private func list(_ kind: ArgusProtocol.GateLogEntryKind) -> [String] {
    (kind == .tool ? host.settings?.automationAllowedTools : host.settings?.automationAllowedCommands) ?? []
  }

  private func add(_ kind: ArgusProtocol.GateLogEntryKind, _ value: String, field: SettingsField) {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, !list(kind).contains(trimmed) else { return }
    write(kind, list(kind) + [trimmed], field: field)
  }

  private func remove(_ kind: ArgusProtocol.GateLogEntryKind, _ value: String) {
    write(kind, list(kind).filter { $0 != value }, field: kind == .tool ? .allowedTools : .allowedCommands)
  }

  private func write(_ kind: ArgusProtocol.GateLogEntryKind, _ next: [String], field: SettingsField) {
    let key = kind == .tool ? "automation_allowed_tools" : "automation_allowed_commands"
    Task {
      await host.save(field, [key: .array(next.map(JSONValue.string))]) {
        if kind == .tool { $0.automationAllowedTools = next } else { $0.automationAllowedCommands = next }
      }
    }
  }

  private func dismiss(_ entry: ArgusProtocol.GateLogEntry, field: SettingsField?) {
    Task {
      await host.run(ArgusProtocol.Commands.AutomationGateLogDismiss.self, .init(id: entry.id))
      if let field { MacTelemetry.capture(.settingsChanged(setting: field)) }
      await loadRefusals()
    }
  }
}

private struct EntryList: View {
  let entries: [String]
  let remove: (String) -> Void

  var body: some View {
    ForEach(entries, id: \.self) { entry in
      HStack {
        Text(entry).font(.body.monospaced())
        Spacer()
        Button("Remove", systemImage: "xmark.circle.fill") { remove(entry) }
          .labelStyle(.iconOnly)
          .buttonStyle(.borderless)
          .help("Remove \(entry)")
      }
    }
  }
}

private struct RefusalRow: View {
  let entry: ArgusProtocol.GateLogEntry
  let onAllow: () -> Void
  let onDismiss: () -> Void

  var body: some View {
    HStack(alignment: .top) {
      VStack(alignment: .leading, spacing: 2) {
        Text(entry.command ?? entry.toolName).font(.body.monospaced()).lineLimit(2)
        Text(
          "\(entry.automationName) · \(Int(entry.count))× · last \(lastSeen) · would allow \(entry.suggestedEntry)"
        )
        .font(.caption)
        .foregroundStyle(.secondary)
      }
      Spacer()
      Button("Allow", action: onAllow)
      Button("Ignore", action: onDismiss)
    }
  }

  private var lastSeen: String {
    let date = Date(timeIntervalSince1970: entry.lastSeenAt / 1000)
    return date.formatted(.relative(presentation: .named))
  }
}
