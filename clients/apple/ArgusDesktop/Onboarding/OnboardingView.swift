import ArgusCore
import ArgusUI
import SwiftUI

/// The first run, step by step, with the desktop's stepper and footer.
struct OnboardingView: View {
  let onboarding: OnboardingModel
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme

  var body: some View {
    VStack(spacing: 0) {
      Stepper(current: onboarding.step).padding(.vertical, 14)
      Divider()
      ScrollView {
        Group {
          switch onboarding.step {
          case .welcome: OnboardingWelcomeStep(onboarding: onboarding)
          case .privacy: OnboardingPrivacyStep(onboarding: onboarding)
          case .setup: OnboardingSetupStep(onboarding: onboarding)
          case .project: OnboardingProjectStep(onboarding: onboarding)
          }
        }
        .padding(28)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .frame(width: 680, height: 620)
    .background(theme.bg)
    .onAppear { MacTelemetry.capture(.screenViewed(screen: "/onboarding/\(onboarding.step.rawValue)")) }
    .onChange(of: onboarding.step) { _, step in
      MacTelemetry.capture(.screenViewed(screen: "/onboarding/\(step.rawValue)"))
    }
  }
}

/// Title, subtitle and the step's body, with the footer pinned under it.
struct OnboardingPage<Content: View, Footer: View>: View {
  let title: String
  let subtitle: String
  var onBack: (() -> Void)?
  @ViewBuilder let content: Content
  @ViewBuilder let footer: Footer
  @Environment(\.theme) private var theme

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      VStack(alignment: .leading, spacing: 6) {
        Text(title).font(.scaled(size: 24, weight: .semibold)).foregroundStyle(theme.text)
        Text(subtitle).foregroundStyle(theme.textSecondary).fixedSize(horizontal: false, vertical: true)
      }
      content
      HStack(spacing: 10) {
        if let onBack { Button("Back", action: onBack) }
        footer
      }
      .padding(.top, 6)
    }
  }
}

private struct Stepper: View {
  let current: OnboardingStepId
  @Environment(\.theme) private var theme

  var body: some View {
    HStack(spacing: 8) {
      ForEach(Array(OnboardingStepId.allCases.enumerated()), id: \.element) { index, step in
        let done = index < OnboardingStepId.allCases.firstIndex(of: current)!
        HStack(spacing: 6) {
          ZStack {
            Circle().fill(step == current || done ? theme.accent : theme.bgTertiary)
            if done {
              Image(systemName: "checkmark").font(.scaled(size: 9, weight: .bold)).foregroundStyle(theme.onAccent)
            } else {
              Text("\(index + 1)").font(.scaled(size: 10, weight: .semibold))
                .foregroundStyle(step == current ? theme.onAccent : theme.textMuted)
            }
          }
          .frame(width: 18, height: 18)
          Text(step.title).font(.scaled(size: 12, weight: step == current ? .semibold : .regular))
            .foregroundStyle(step == current ? theme.text : theme.textMuted)
        }
        if step != OnboardingStepId.allCases.last {
          Rectangle().fill(theme.border).frame(width: 24, height: 1)
        }
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Step \(OnboardingStepId.allCases.firstIndex(of: current)! + 1): \(current.title)")
  }
}

struct OnboardingWelcomeStep: View {
  let onboarding: OnboardingModel
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme

  private static let points = [
    "One git worktree per parallel task — no stashing, no branch juggling.",
    "Claude Code agents you can steer in plan, acceptEdits, or auto mode.",
    "Live iOS / Android / web previews inside the same window.",
  ]

  var body: some View {
    OnboardingPage(
      title: "Welcome to Argus",
      subtitle: "An agentic IDE for mobile and web. Argus orchestrates parallel Claude Code agents in isolated git worktrees, each with live iOS simulators, Android emulators, and a browser for instant testing."
    ) {
      VStack(alignment: .leading, spacing: 8) {
        Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 96, height: 96)
        ForEach(Self.points, id: \.self) { Text("•  \($0)").foregroundStyle(theme.text) }
      }
    } footer: {
      Button("I've done this before — skip onboarding") {
        guard let backend = model.backend else { return }
        Task { await onboarding.complete(backend) }
      }
      .buttonStyle(.link)
      Spacer()
      Button("Get started") {
        guard let backend = model.backend else { return }
        MacTelemetry.capture(.onboardingStep(step: OnboardingStepId.welcome.rawValue, skipped: false))
        Task { await onboarding.go(to: .privacy, backend) }
      }
      .buttonStyle(.borderedProminent)
      .keyboardShortcut(.defaultAction)
    }
  }
}

struct OnboardingPrivacyStep: View {
  let onboarding: OnboardingModel
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  @State private var busy = false

  var body: some View {
    OnboardingPage(
      title: "Help improve Argus",
      subtitle: "Pick how much you want to share. You can change this any time under Settings → Privacy.",
      onBack: back
    ) {
      VStack(alignment: .leading, spacing: 14) {
        section(
          "Just count me",
          [
            "One event per launch — anonymous install id + app version, nothing else.",
            "Lets us see roughly how many people are using Argus without learning what anyone does.",
            "This is the minimum — Argus always sends this heartbeat.",
          ])
        section(
          "Share anonymous data",
          [
            "App version, OS, OS version, CPU arch.",
            "Feature usage events (which screens you open, which actions you take).",
            "Errors and crashes from the app and its host.",
            "Any feedback you submit through the in-app feedback button.",
          ])
        section(
          "What we never collect",
          [
            "Your IP address (PostHog discards it after deriving country/city) or screen recordings.",
            "Prompts, file contents, agent output, project names, branch names, repo paths.",
            "Anything that ties your install id to a person, account, or machine.",
          ])
      }
    } footer: {
      Spacer()
      Button(busy ? "Saving…" : "Just count me") { choose("presence") }.disabled(busy)
      Button(busy ? "Saving…" : "Share anonymous data") { choose("full") }
        .buttonStyle(.borderedProminent)
        .disabled(busy)
    }
  }

  private func back() {
    guard let backend = model.backend else { return }
    Task { await onboarding.go(to: .welcome, backend) }
  }

  private func choose(_ mode: String) {
    guard let backend = model.backend, !busy else { return }
    busy = true
    Task {
      await onboarding.chooseTelemetry(mode, backend)
      busy = false
    }
  }

  private func section(_ title: String, _ items: [String]) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title).font(.scaled(size: 13, weight: .semibold))
      ForEach(items, id: \.self) {
        Text("•  \($0)").foregroundStyle(theme.textSecondary).fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}
