import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

struct OnboardingSetupStep: View {
  let onboarding: OnboardingModel
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  private var checks: PrereqChecks { .shared }

  var body: some View {
    OnboardingPage(
      title: "Check your Mac",
      subtitle: "Argus needs the Claude Code CLI, a signed-in Claude account and git to run agents. Anything still missing shows up as a card on the home screen too.",
      onBack: { go(.privacy) }
    ) {
      VStack(alignment: .leading, spacing: 18) {
        PrereqChecklist(ids: SetupChecks.core)
        if checks.results[.claudeCli]?.status == .pass {
          VStack(alignment: .leading, spacing: 8) {
            Text("Claude account").font(.scaled(.headline))
            ClaudeSignInView()
          }
        }
      }
    } footer: {
      Spacer()
      Button("Skip for now") { skip() }
      Button("Continue") { advance() }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
    }
    .task {
      guard let backend = model.backend else { return }
      checks.listen(model.store)
      await checks.run(backend, force: true)
    }
  }

  private func go(_ step: OnboardingStepId) {
    guard let backend = model.backend else { return }
    Task { await onboarding.go(to: step, backend) }
  }

  private func skip() {
    guard let backend = model.backend else { return }
    Task { await onboarding.skip(backend) }
  }

  private func advance() {
    guard let backend = model.backend else { return }
    MacTelemetry.capture(.onboardingStep(step: OnboardingStepId.setup.rawValue, skipped: false))
    Task { await onboarding.advance(backend) }
  }
}

/// A native folder picker over the key window.
enum FolderPicker {
  @MainActor
  static func pick(prompt: String = "Add Project") async -> String? {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = true
    panel.prompt = prompt
    let response: NSApplication.ModalResponse
    if let window = NSApp.keyWindow {
      response = await panel.beginSheetModal(for: window)
    } else {
      response = await withCheckedContinuation { done in panel.begin { done.resume(returning: $0) } }
    }
    return response == .OK ? panel.url?.path : nil
  }
}
