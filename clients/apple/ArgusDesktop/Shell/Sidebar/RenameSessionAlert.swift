import ArgusCore
import SwiftUI

/// The sidebar's Rename Session… / Rename Scratch Pad…: the same name alert an agent tab's
/// Rename Agent… shows. Only the session's name changes, not its branch.
private struct RenameSessionAlert: ViewModifier {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var store
  @State private var name = ""

  func body(content: Content) -> some View {
    content
      .alert(title, isPresented: presented) {
        TextField("Name", text: $name)
        Button("Rename", action: rename)
        Button("Cancel", role: .cancel) { model.renamingSession = nil }
      }
      .onChange(of: model.renamingSession?.id) {
        name = model.renamingSession.map { SessionActivity.title($0) } ?? ""
      }
  }

  private var title: String { model.renamingSession?.kind == .scratchPad ? "Rename Scratch Pad" : "Rename Session" }

  private var presented: Binding<Bool> {
    Binding(get: { model.renamingSession != nil }, set: { if !$0 { model.renamingSession = nil } })
  }

  private func rename() {
    guard let session = model.renamingSession else { return }
    model.renamingSession = nil
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed != SessionActivity.title(session) else { return }
    MacTelemetry.capture(.sessionRenamed(kind: session.kind == .scratchPad ? .scratchPad : .worktree))
    Task { await store.renameSession(id: session.id, repoRoot: session.repoRoot, name: trimmed) }
  }
}

extension View {
  func renameSessionAlert() -> some View { modifier(RenameSessionAlert()) }
}
