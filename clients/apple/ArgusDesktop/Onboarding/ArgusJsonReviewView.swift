import ArgusCore
import ArgusUI
import SwiftUI

/// Pick how to generate a `.argus.json`, review it, save it. Used by the first
/// run's project step and by Add Project.
struct ArgusJsonReviewView: View {
  let generator: ArgusJsonGenerator
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      switch generator.phase {
      case .loading:
        ProgressView().frame(maxWidth: .infinity)
      case .existing:
        Label("This project already has a .argus.json.", systemImage: "checkmark.circle.fill")
          .foregroundStyle(theme.success)
        Text("Argus uses it to set up new sessions. Edit it any time from Project Settings.")
          .foregroundStyle(theme.textSecondary)
      case .choosing, .generatingQuick, .generatingClaude:
        choosing
      case .reviewing, .saving:
        reviewing
      case .saved:
        Label("Saved .argus.json to the repo root.", systemImage: "checkmark.circle.fill")
          .foregroundStyle(theme.success)
      }
      if let error = generator.error {
        Text(error).foregroundStyle(theme.error).textSelection(.enabled)
      }
    }
    .task { if generator.phase == .loading, let backend { await generator.load(backend) } }
  }

  private var backend: HostRouter? { model.backend }

  private var choosing: some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(
        "An .argus.json tells Argus how to set up new worktrees for this project — which directories to copy (node_modules, Pods), which files to symlink (.env), which install commands to run, and which ports to allocate per session. It's checked in so the whole team shares the same setup."
      )
      .foregroundStyle(theme.textSecondary)
      .fixedSize(horizontal: false, vertical: true)
      option(
        title: "Quick generate",
        detail: "Inspect package.json, lockfiles, and platform dirs and write a sensible default. Fast, no network, no LLM.",
        button: generator.phase == .generatingQuick ? "Generating…" : "Quick generate",
        busy: generator.phase == .generatingQuick, prominent: false
      ) { await generator.quick($0) }
      option(
        title: "Generate with Claude",
        detail: "Run the Claude CLI in this project to refine the config — it reads your scripts, native targets, and env files and produces a tailored result. Takes ~30–90s. Requires the claude CLI to be installed and authenticated.",
        button: generator.phase == .generatingClaude ? "Asking Claude…" : "Generate with Claude",
        busy: generator.phase == .generatingClaude, prominent: true
      ) { await generator.claude($0) }
    }
  }

  private func option(
    title: String, detail: String, button: String, busy: Bool, prominent: Bool,
    run: @escaping (HostRouter) async -> Void
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.scaled(.headline))
      Text(detail).foregroundStyle(theme.textSecondary).fixedSize(horizontal: false, vertical: true)
      HStack {
        Button {
          guard let backend else { return }
          Task { await run(backend) }
        } label: {
          HStack(spacing: 6) {
            if busy { ProgressView().controlSize(.small) }
            Text(button)
          }
        }
        .disabled(generator.isBusy)
        .modifier(Prominent(on: prominent))
      }
    }
  }

  private var reviewing: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(
        generator.source == .claude
          ? "Claude proposed the following .argus.json. Review the contents and save it to write the file to the repo root."
          : "Argus inferred the following .argus.json from your project. Review the contents and save it to write the file to the repo root."
      )
      .foregroundStyle(theme.textSecondary)
      .fixedSize(horizontal: false, vertical: true)
      if !generator.signals.isEmpty {
        FlowRow(spacing: 6, packed: true) {
          ForEach(Array(generator.signals.enumerated()), id: \.offset) { _, signal in
            Badge(label: signal.label, tone: .accent).fixedSize().help(signal.detail ?? signal.kind.rawValue)
          }
        }
      }
      JSONCodeView(text: generator.proposedText)
      HStack {
        Button("Discard") { generator.discard() }.disabled(generator.isBusy)
        Spacer()
        Button {
          guard let backend else { return }
          Task { await generator.save(backend) }
        } label: {
          Text(generator.phase == .saving ? "Saving…" : "Save .argus.json")
        }
        .buttonStyle(.borderedProminent)
        .disabled(generator.isBusy)
      }
    }
  }
}

/// Read-only, selectable JSON in a scrolling code box.
struct JSONCodeView: View {
  let text: String
  @Environment(\.theme) private var theme

  var body: some View {
    ScrollView {
      Text(text)
        .font(.scaled(size: 12, design: .monospaced))
        .foregroundStyle(theme.text)
        .textSelection(.enabled)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(height: 220)
    .background(theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).stroke(theme.borderSubtle))
  }
}

private struct Prominent: ViewModifier {
  let on: Bool
  func body(content: Content) -> some View {
    if on { content.buttonStyle(.borderedProminent) } else { content.buttonStyle(.bordered) }
  }
}
