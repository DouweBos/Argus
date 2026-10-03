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
            Text("Claude account").font(.headline)
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

struct OnboardingProjectStep: View {
  let onboarding: OnboardingModel
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var generator: ArgusJsonGenerator?

  var body: some View {
    OnboardingPage(
      title: generator == nil ? "Add your first project" : "Finish setting up this project",
      subtitle: generator == nil
        ? "Open a git repository on this Mac, or clone an example to try Argus on."
        : "Argus uses an .argus.json to know how to copy files, run commands, and allocate ports when creating sessions.",
      onBack: generator == nil ? { go(.setup) } : { generator = nil }
    ) {
      if let generator {
        Label(projectName(generator.repoRoot), systemImage: "folder.fill").font(.headline)
        ArgusJsonReviewView(generator: generator)
      } else {
        picker
      }
    } footer: {
      Spacer()
      if generator == nil {
        Button("Skip for now") { skip() }
      } else {
        Button("Finish") { finish() }
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
          .disabled(generator?.isBusy == true)
      }
    }
    .onChange(of: onboarding.addedProject) { _, path in
      if let path { generator = ArgusJsonGenerator(repoRoot: path) }
    }
  }

  @ViewBuilder private var picker: some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack {
        Button {
          Task {
            guard let backend = model.backend, let path = await FolderPicker.pick() else { return }
            await onboarding.add(path, source: .openPanel, backend)
          }
        } label: {
          Label("Choose a folder…", systemImage: "folder.badge.plus")
        }
        .buttonStyle(.borderedProminent)
      }
      if let error = onboarding.error {
        Text(error).foregroundStyle(theme.error).textSelection(.enabled)
      }
      let recents = onboarding.recentProjects.filter { FileManager.default.fileExists(atPath: $0) }
      if !recents.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text("Recent projects").font(.headline)
          ForEach(recents, id: \.self) { path in
            Button {
              guard let backend = model.backend else { return }
              Task { await onboarding.add(path, source: .recent, backend) }
            } label: {
              HStack {
                Image(systemName: "folder")
                VStack(alignment: .leading) {
                  Text(projectName(path))
                  Text(path).font(.caption).foregroundStyle(theme.textMuted).lineLimit(1).truncationMode(.middle)
                }
              }
            }
            .buttonStyle(.plain)
          }
        }
      }
      ExamplesList(onboarding: onboarding)
    }
  }

  private func projectName(_ path: String) -> String {
    URL(fileURLWithPath: path).lastPathComponent
  }

  private func go(_ step: OnboardingStepId) {
    guard let backend = model.backend else { return }
    Task { await onboarding.go(to: step, backend) }
  }

  private func skip() {
    guard let backend = model.backend else { return }
    Task { await onboarding.skip(backend) }
  }

  private func finish() {
    guard let backend = model.backend else { return }
    MacTelemetry.capture(.onboardingStep(step: OnboardingStepId.project.rawValue, skipped: false))
    let path = onboarding.addedProject
    Task {
      await onboarding.complete(backend)
      if let path { await model.openProjectRoot(path) }
    }
  }
}

/// The example projects the host can clone, to try Argus without a repo.
private struct ExamplesList: View {
  let onboarding: OnboardingModel
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Or try an example").font(.headline)
      if let examples = onboarding.examples {
        if examples.isEmpty { Text("No examples available.").foregroundStyle(theme.textMuted) }
        ForEach(examples, id: \.slug) { example in
          HStack(alignment: .top) {
            Image(systemName: icon(example.platform.rawValue)).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
              Text(example.name)
              Text(example.description).font(.caption).foregroundStyle(theme.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button(onboarding.cloning == example.slug ? "Cloning…" : "Clone") {
              guard let backend = model.backend else { return }
              Task { await onboarding.clone(example, backend) }
            }
            .disabled(onboarding.cloning != nil)
          }
          .padding(.vertical, 4)
        }
      } else {
        ProgressView().controlSize(.small)
      }
    }
    .task {
      guard let backend = model.backend else { return }
      await onboarding.loadExamples(backend)
    }
  }

  private func icon(_ platform: String) -> String {
    switch platform {
    case "ios": "iphone"
    case "android": "candybarphone"
    default: "globe"
    }
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
