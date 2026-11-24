import ArgusCore
import ArgusUI
import SwiftUI

/// `/teammates/:id/duties`: the automations it runs, each opening on the
/// automation screen. Bringing in an existing automation moves its memories.
struct TeammateDutiesView: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TeammatesStore.self) private var store
  @Environment(AutomationsStore.self) private var automations
  let teammateId: String

  private var duties: [RemoteAutomation] {
    (store.detailById[teammateId]?.duties ?? []).compactMap(RemoteAutomation.init(wire:))
  }

  private var standalone: [RemoteAutomation] {
    automations.automations.filter { $0.teammateId == nil }
  }

  var body: some View {
    Form {
      Section {
        if duties.isEmpty {
          Text("No duties yet. Bring in an automation and it runs on its own trigger, as this teammate.")
            .foregroundStyle(.secondary)
        }
        ForEach(duties) { duty in
          Button { model.navigate(.automation(id: duty.id, runId: nil)) } label: {
            AutomationRow(automation: duty, lastRunAt: duty.lastRunAt).contentShape(.rect)
          }
          .buttonStyle(.argusPlain)
          .contextMenu {
            Button("Open") { model.navigate(.automation(id: duty.id, runId: nil)) }
            Button("Remove from Teammate") {
              Task { await store.removeDuty(teammateId: teammateId, automationId: duty.id) }
            }
          }
        }
      } header: {
        HStack {
          Text("Duties")
          Spacer()
          Menu("Add Automation") {
            ForEach(standalone) { automation in
              Button(automation.name) { Task { await add(automation.id) } }
            }
          }
          .menuStyle(.borderlessButton).fixedSize().clickable()
          .disabled(standalone.isEmpty)
        }
      } footer: {
        Text("A duty shares this teammate's memory and never goes further than its autonomy.")
      }
    }
    .formStyle(.grouped)
    .task { await automations.refresh() }
  }

  private func add(_ automationId: String) async {
    _ = await store.promote(automationId: automationId, into: teammateId)
    await store.loadDetail(id: teammateId)
    await automations.refresh()
  }
}

/// `/teammates/:id/memory`: what it remembers — one memory every duty and
/// conversation reads and writes.
struct TeammateMemoryView: View {
  @Environment(TeammatesStore.self) private var store
  let teammateId: String
  @State private var open: Selection?

  private struct Selection: Identifiable {
    let memory: RemoteAutomationMemory?
    var id: String { memory?.name ?? "+new" }
  }

  var body: some View {
    let memories = store.memoriesById[teammateId] ?? []
    Form {
      Section {
        if memories.isEmpty {
          Text("Nothing yet. Tell it to remember something, or let its duties save what they learn.")
            .foregroundStyle(.secondary)
        }
        ForEach(memories) { memory in
          Button { open = Selection(memory: memory) } label: {
            HStack {
              VStack(alignment: .leading, spacing: 2) {
                Text(memory.name).font(.system(.body, design: .monospaced))
                Text(memory.description).font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1)
              }
              Spacer()
              Badge(label: memory.type.rawValue)
            }
            .contentShape(.rect)
          }
          .buttonStyle(.argusPlain)
        }
      } header: {
        HStack {
          Text("Memories")
          Spacer()
          Button("Add Memory") { open = Selection(memory: nil) }.controlSize(.small)
        }
      } footer: {
        Text("Plain markdown files on this host; up to 100.")
      }
    }
    .formStyle(.grouped)
    .task { await store.loadMemories(teammateId: teammateId) }
    .sheet(item: $open) { selection in
      TeammateMemoryEditorSheet(teammateId: teammateId, memory: selection.memory)
        .frame(minWidth: 560, minHeight: 520)
    }
  }
}

/// `/teammates/:id/profile`: who it is, its soul, what it looks after and
/// how far it may go. Saving is explicit.
struct TeammateProfileForm: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TeammatesStore.self) private var store
  let teammateId: String

  @State private var draft: TeammateDraft?
  @State private var saved: TeammateDraft?
  @State private var saving = false
  @State private var confirmingDelete = false
  @State private var revising = false

  var body: some View {
    Group {
      if let draft = Binding($draft) {
        form(draft)
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .toolbar {
      ToolbarItemGroup {
        Button("Delete", role: .destructive) { confirmingDelete = true }
        Button(saving ? "Saving" : "Save") { save() }
          .disabled(saving || draft == saved || !(draft?.canSave ?? false))
      }
    }
    .confirmationDialog("Delete this teammate?", isPresented: $confirmingDelete) {
      Button("Delete and Keep Its Automations") { delete(keepDuties: true) }
      Button("Delete With Its Automations", role: .destructive) { delete(keepDuties: false) }
    } message: {
      Text("Its conversations and memory go with it. Kept automations stay paused, on their own.")
    }
    .task {
      if let detail = await store.loadDetail(id: teammateId) {
        let loaded = TeammateDraft(detail.teammate, soul: detail.soul)
        draft = loaded
        saved = loaded
      }
    }
  }

  private func form(_ draft: Binding<TeammateDraft>) -> some View {
    Form {
      Section("Identity") {
        HStack(spacing: 12) {
          TeammateAvatar(
            name: draft.wrappedValue.name, color: draft.wrappedValue.color,
            avatar: draft.wrappedValue.avatar, size: 44)
          VStack(alignment: .leading) {
            TextField("Name", text: draft.name)
            TextField("Handle", text: draft.handle)
          }
        }
        if let error = draft.wrappedValue.handleError {
          Text(error).font(.scaled(.caption)).foregroundStyle(.red)
        }
        TextField("Tagline", text: draft.tagline)
        Picker("Colour", selection: draft.color) {
          ForEach(TeammateDraft.colors, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
        }
        Picker("Symbol", selection: draft.symbol) {
          Text("Initials").tag(ArgusProtocol.TeammateSymbol?.none)
          ForEach(TeammateDraft.symbols, id: \.self) { symbol in
            Label(symbol.rawValue.capitalized, systemImage: TeammateAvatar.systemName(symbol))
              .tag(ArgusProtocol.TeammateSymbol?.some(symbol))
          }
        }
      }
      Section {
        TextEditor(text: draft.soul)
          .font(.system(.body, design: .monospaced))
          .frame(minHeight: 180)
      } header: {
        HStack {
          Text("Soul")
          Spacer()
          Button("Rewrite with Claude") { revising = true }.controlSize(.small)
        }
      } footer: {
        Text("Who it is and how it works, in markdown. Every duty and conversation starts from it.")
      }
      ProjectScopeSection(selection: draft.repoRoots, footer: "Projects it looks after; new duties start here.")
      AutonomySection(autonomy: draft.autonomy, guardrails: draft.guardrails)
    }
    .formStyle(.grouped)
    .sheet(isPresented: $revising) {
      SoulRewriteSheet(name: draft.wrappedValue.name, soul: draft.wrappedValue.soul) { draft.wrappedValue.soul = $0 }
    }
  }

  /// Back to inheriting what was set; the wire's patch can't carry a null.
  private func cleared(_ draft: TeammateDraft) -> [ArgusProtocol.TeammateClearableField] {
    saved?.autonomy != nil && draft.autonomy == nil ? [.autonomy] : []
  }

  private func save() {
    guard let draft else { return }
    saving = true
    Task {
      var ok = await store.update(teammateId, draft.patch, clear: cleared(draft))
      if ok, draft.soul != saved?.soul { ok = await store.saveSoul(teammateId, soul: draft.soul) }
      saving = false
      if ok { saved = draft }
    }
  }

  private func delete(keepDuties: Bool) {
    Task {
      if await store.delete(teammateId, keepDuties: keepDuties) { model.navigate(.teammates) }
    }
  }
}

/// An instruction in, a rewritten soul shown beside it; Apply puts it in the editor.
private struct SoulRewriteSheet: View {
  @Environment(TeammatesStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  let name: String
  let soul: String
  let apply: (String) -> Void

  @State private var instruction = ""
  @State private var rewritten: String?
  @State private var working = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField(
            "Instruction", text: $instruction,
            prompt: Text("Be blunter, and always quote the failing line"), axis: .vertical
          )
          .lineLimit(2...5)
        } footer: {
          Text("Claude rewrites the soul around this, keeping the rest. Nothing is saved until you save the profile.")
        }
        if let rewritten {
          Section("Rewritten") {
            Text(rewritten).font(.system(.body, design: .monospaced)).textSelection(.enabled)
          }
        }
        if let error = store.error {
          Text(error).foregroundStyle(.secondary)
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Rewrite \(name)'s Soul")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          if let rewritten {
            Button("Apply") {
              apply(rewritten)
              dismiss()
            }
          } else {
            Button(working ? "Rewriting" : "Rewrite") { rewrite() }
              .disabled(working || instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
      }
    }
    .frame(minWidth: 560, minHeight: 420)
  }

  private func rewrite() {
    working = true
    Task {
      rewritten = await store.reviseSoul(name: name, soul: soul, instruction: instruction)
      working = false
    }
  }
}
