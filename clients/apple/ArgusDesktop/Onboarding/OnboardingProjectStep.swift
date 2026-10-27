import ArgusCore
import ArgusKit
import ArgusUI
import SwiftUI

/// The last step: the projects Claude Code has been used in, ticked to add in
/// one go, with a folder, a recent project or an example as fallbacks.
struct OnboardingProjectStep: View {
  let onboarding: OnboardingModel
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var generator: ArgusJsonGenerator?

  private var picker: CliProjectPicker { onboarding.cliProjects }
  private var hasSuggestions: Bool { !picker.suggestions.isEmpty }
  private var scanning: Bool { picker.scan == nil && picker.error == nil }

  var body: some View {
    OnboardingPage(
      title: generator == nil ? "Add your first project" : "Finish setting up this project",
      subtitle: subtitle,
      onBack: generator == nil ? { go(.setup) } : { generator = nil }
    ) {
      if let generator {
        Label(projectName(generator.repoRoot), systemImage: "folder.fill").font(.scaled(.headline))
        ArgusJsonReviewView(generator: generator)
      } else {
        VStack(alignment: .leading, spacing: 22) {
          if scanning || hasSuggestions { suggestions }
          addAnother(prominent: !scanning && !hasSuggestions)
          ExamplesList(onboarding: onboarding)
        }
      }
    } footer: {
      Spacer()
      if generator == nil {
        Button("Skip for now") { skip() }
        if hasSuggestions {
          Button(picker.importing ? "Importing…" : CliProjectImport.importLabel(picker.picked.count)) {
            importPicked()
          }
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
          .disabled(picker.picked.isEmpty || picker.importing)
        }
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
    .task {
      guard let backend = model.backend else { return }
      await picker.load(backend)
    }
  }

  private var subtitle: String {
    if generator != nil {
      return "Argus uses an .argus.json to know how to copy files, run commands, and allocate ports when creating sessions."
    }
    if hasSuggestions {
      return "Pick the projects you've used Claude Code in — their chats come along into history — or open another git repository."
    }
    return "Open a git repository on this Mac, or clone an example to try Argus on."
  }

  private var suggestions: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("From Claude Code").font(.scaled(.headline))
      if scanning {
        HStack(spacing: 8) {
          ProgressView().controlSize(.small)
          Text("Looking through your Claude Code chats…").foregroundStyle(theme.textMuted)
        }
        .padding(.vertical, 6)
      } else {
        CliProjectList(picker: picker, showsAdded: false, scrolls: false)
      }
    }
  }

  private func addAnother(prominent: Bool) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      if hasSuggestions { Text("Or add another").font(.scaled(.headline)) }
      Button {
        Task {
          guard let backend = model.backend, let path = await FolderPicker.pick() else { return }
          await onboarding.add(path, source: .openPanel, backend)
        }
      } label: {
        Label("Choose a folder…", systemImage: "folder.badge.plus")
      }
      .buttonStyle(ChooseFolderStyle(prominent: prominent))
      // A failed scan just hides the suggestions; a failed import shows here.
      if let error = onboarding.error ?? (hasSuggestions ? picker.error : nil) {
        Text(error).foregroundStyle(theme.error).textSelection(.enabled)
      }
      recents
    }
  }

  @ViewBuilder private var recents: some View {
    let suggested = Set(picker.suggestions.map(\.path))
    let recents = onboarding.recentProjects.filter {
      !suggested.contains($0) && FileManager.default.fileExists(atPath: $0)
    }
    if !recents.isEmpty {
      VStack(alignment: .leading, spacing: 6) {
        Text("Recent projects").font(.scaled(.subheadline)).foregroundStyle(theme.textSecondary)
        ForEach(recents, id: \.self) { path in
          Button {
            guard let backend = model.backend else { return }
            Task { await onboarding.add(path, source: .recent, backend) }
          } label: {
            HStack {
              Image(systemName: "folder")
              VStack(alignment: .leading) {
                Text(projectName(path))
                Text(path).font(.scaled(.caption)).foregroundStyle(theme.textMuted).lineLimit(1).truncationMode(.middle)
              }
            }
          }
          .buttonStyle(.argusPlain)
        }
      }
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

  private func importPicked() {
    guard let backend = model.backend else { return }
    let newest = picker.mostRecentPicked
    Task {
      if await picker.importPicked(backend), let newest { onboarding.addedProject = newest }
    }
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

/// Prominent when choosing a folder is the main way forward, plain beside suggestions.
private struct ChooseFolderStyle: PrimitiveButtonStyle {
  let prominent: Bool

  func makeBody(configuration: Configuration) -> some View {
    if prominent {
      Button(configuration).buttonStyle(.borderedProminent)
    } else {
      Button(configuration).buttonStyle(.bordered)
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
      Text("Or try an example").font(.scaled(.headline))
      if let examples = onboarding.examples {
        if examples.isEmpty { Text("No examples available.").foregroundStyle(theme.textMuted) }
        ForEach(examples, id: \.slug) { example in
          HStack(alignment: .top) {
            Image(systemName: icon(example.platform.rawValue)).frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
              Text(example.name)
              Text(example.description).font(.scaled(.caption)).foregroundStyle(theme.textMuted)
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
