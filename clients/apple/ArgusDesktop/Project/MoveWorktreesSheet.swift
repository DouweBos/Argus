import ArgusCore
import ArgusUI
import SwiftUI

/// Offered before a new worktree location is committed. Moving is optional:
/// worktrees left behind keep working from the old location.
struct MoveWorktreesSheet: View {
  let repoRoot: String
  let toBaseDir: String
  let purpose: ArgusProtocol.WorktreePurpose
  /// Runs on close, whatever was chosen: the new location is saved either way.
  let onClose: () -> Void
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme

  private enum Phase { case loading, confirm, moving, done }

  struct Progress: Decodable {
    let repo_root: String
    let branch: String
    let index: Int
    let total: Int
    let step: String
    let done_entries: Int
    let total_entries: Int

    var fraction: Double {
      let current: Double =
        step == "removing" ? 1 : step == "copying" && total_entries > 0 ? Double(done_entries) / Double(total_entries) : 0
      return total > 0 ? (Double(index) + current) / Double(total) : 0
    }

    var stepLabel: String {
      switch step {
      case "counting": "Counting files…"
      case "copying": total_entries > 0 ? "Copying \(done_entries) of \(total_entries) files" : "Copying…"
      case "removing": "Removing the old copy…"
      default: "Moving…"
      }
    }
  }

  @State private var phase = Phase.loading
  @State private var plan: ArgusProtocol.MoveWorktreesPlan?
  @State private var result: ArgusProtocol.MoveWorktreesResult?
  @State private var progress: Progress?
  @State private var error: String?

  private var count: Int { plan?.sessions.count ?? 0 }
  private var noun: String { "\(purpose == .automation ? "automation " : "")worktree\(count == 1 ? "" : "s")" }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text(purpose == .automation ? "Move existing automation worktrees?" : "Move existing worktrees?")
        .font(.title3.weight(.semibold))
      if let error { Text(error).foregroundStyle(theme.error) }
      switch phase {
      case .loading:
        ProgressView().frame(maxWidth: .infinity)
      case .confirm:
        Text(
          count > 0
            ? "Argus can move \(count) \(noun) to the new location, or leave them where they are and use it for new sessions only."
            : "There are no worktrees to move. New sessions will use the new location."
        )
        .fixedSize(horizontal: false, vertical: true)
        if let to = plan?.toRoot { Text(to).font(.system(.callout, design: .monospaced)).textSelection(.enabled) }
        if let blockers = plan?.blockers, !blockers.isEmpty {
          Text(
            "These will be stopped first: \(blockers.map { "\($0.sessionLabel) (\($0.detail))" }.joined(separator: ", ")). They are skipped by this move."
          )
          .foregroundStyle(theme.warning)
        }
      case .moving:
        Text(progress.map { "Moving \($0.index + 1) of \($0.total): \($0.branch)" } ?? "Moving \(count) \(noun)…")
        if let progress {
          ProgressView(value: progress.fraction)
          Text(progress.stepLabel).font(.caption).foregroundStyle(theme.textMuted)
        } else {
          ProgressView().progressViewStyle(.linear)
        }
      case .done:
        Text("Moved \(result?.moved.count ?? 0) of \(count).")
        if let failed = result?.failed, !failed.isEmpty {
          Text(
            "\(failed.count) couldn't be moved and are still at the old location, where they keep working. Try again once whatever is holding them has stopped."
          )
          .foregroundStyle(theme.error)
        }
      }
      HStack {
        Spacer()
        switch phase {
        case .confirm:
          Button("Leave them") { close() }.keyboardShortcut(.cancelAction)
          Button("Move \(count) \(noun)") { start() }
            .buttonStyle(.borderedProminent)
            .disabled(count == 0)
        case .moving:
          Button("Moving…") {}.disabled(true)
        case .done:
          Button("Done") { close() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
        case .loading:
          EmptyView()
        }
      }
    }
    .padding(22)
    .frame(width: 480)
    // Interrupting a move mid-copy is how you end up with two half trees.
    .interactiveDismissDisabled(phase == .moving)
    .task { await loadPlan() }
    .task {
      let stop = model.store.observeIpc { channel, args, _ in
        guard channel == "session:worktrees-move-progress", let arg = args.first,
          let next = try? ProtocolCodec.convert(arg, to: Progress.self), next.repo_root == repoRoot
        else { return }
        progress = next
      }
      while !Task.isCancelled { try? await Task.sleep(for: .seconds(3600)) }
      stop()
    }
  }

  private func loadPlan() async {
    guard let backend = model.backend else { return }
    do {
      plan = try await backend.request(
        ArgusProtocol.Commands.PlanWorktreesMove.self,
        .init(repoRoot: repoRoot, toBaseDir: toBaseDir, purpose: purpose))
    } catch {
      self.error = HostStore.describe(error)
    }
    phase = .confirm
  }

  private func start() {
    guard let backend = model.backend else { return }
    phase = .moving
    progress = nil
    Task {
      do {
        result = try await backend.request(
          ArgusProtocol.Commands.MoveWorktrees.self,
          .init(repoRoot: repoRoot, toBaseDir: toBaseDir, purpose: purpose))
        phase = .done
      } catch {
        self.error = HostStore.describe(error)
        phase = .confirm
      }
    }
  }

  private func close() {
    dismiss()
    onClose()
  }
}
