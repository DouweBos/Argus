import ArgusCore
import ArgusKit
import SwiftUI

/// One slot of a compare run: what it ran on, what it changed, how its runs and tests
/// stand, what it cost, and what its simulator or browser shows.
public struct CompareSlotCard: View {
  @Environment(\.theme) private var theme
  let score: CompareSlotScore
  let runner: String
  let model: String?
  let reviewComments: Int
  let screenshot: PlatformImage?
  let loadingScreenshot: Bool
  let keeping: Bool
  let onOpen: () -> Void
  /// Nil hides keeping: a monitor-only phone can't act.
  let onKeep: (() -> Void)?

  public init(
    score: CompareSlotScore, runner: String, model: String?, reviewComments: Int = 0,
    screenshot: PlatformImage? = nil, loadingScreenshot: Bool = false, keeping: Bool = false,
    onOpen: @escaping () -> Void, onKeep: (() -> Void)?
  ) {
    self.score = score
    self.runner = runner
    self.model = model
    self.reviewComments = reviewComments
    self.screenshot = screenshot
    self.loadingScreenshot = loadingScreenshot
    self.keeping = keeping
    self.onOpen = onOpen
    self.onKeep = onKeep
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      header
      screen
      VStack(alignment: .leading, spacing: 6) {
        metric(Icon.changes, "Changes", value: diffText, tone: nil)
        metric(Icon.play, "Run", value: runText(score.appRuns), tone: tone(score.appRuns))
        metric(Icon.check, "Tests", value: runText(score.testRuns), tone: tone(score.testRuns))
        metric(Icon.chat, "Review comments", value: "\(reviewComments)", tone: reviewComments > 0 ? .warning : nil)
        metric(Icon.usage, "Cost", value: CompareFormat.cost(score.costUsd), tone: nil)
        metric(Icon.agent, "Tokens", value: CompareFormat.tokens(score.tokens), tone: nil)
      }
      HStack(spacing: 8) {
        Btn(label: "Open", tone: .secondary, small: true, hugs: true, action: onOpen)
        Spacer(minLength: 0)
        if let onKeep {
          Btn(label: "Keep this one", small: true, icon: Icon.check, hugs: true, busy: keeping, action: onKeep)
            .disabled(score.isWorking || keeping)
        }
      }
    }
    .padding(theme.space)
    .frame(maxWidth: .infinity, alignment: .leading)
    .cardSurface(stroke: nil)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(runner)\(model.map { ", \($0)" } ?? "")")
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      StatusDot(
        tone: statusTone, pulse: score.isWorking, accessibilityLabel: statusLabel)
      VStack(alignment: .leading, spacing: 2) {
        Text(runner).font(.scaled(size: 14, weight: .semibold)).foregroundStyle(theme.text).lineLimit(1)
        if let model {
          Text(model).font(.scaled(size: 12)).foregroundStyle(theme.textSecondary).lineLimit(1)
        }
      }
      Spacer(minLength: 0)
      Badge(label: statusLabel, tone: statusTone)
    }
  }

  private var screen: some View {
    ZStack {
      // Black only behind a picture: the muted placeholder vanishes on it in light mode.
      RoundedRectangle(cornerRadius: theme.radiusSmall).fill(screenshot == nil ? theme.bgTertiary : theme.mediaBg)
      if let screenshot {
        Image(platformImage: screenshot).resizable().scaledToFit()
          .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
          .accessibilityLabel("Screenshot")
      } else if loadingScreenshot {
        ProgressView().controlSize(.small)
      } else {
        VStack(spacing: 4) {
          Image(systemName: Icon.simulator).font(.scaled(size: 18))
          Text(score.hasScreen ? "No screenshot" : "No simulator or browser").font(.scaled(size: 11))
        }
        .foregroundStyle(theme.textMuted)
      }
    }
    .frame(height: 220)
    .frame(maxWidth: .infinity)
  }

  private func metric(_ icon: String, _ label: String, value: String, tone: Tone?) -> some View {
    HStack(spacing: 8) {
      Image(systemName: icon).font(.scaled(size: 11)).foregroundStyle(theme.textMuted).frame(width: 16)
      Text(label).font(.scaled(size: 12)).foregroundStyle(theme.textSecondary)
      Spacer(minLength: 8)
      Text(value).font(.scaled(size: 12, weight: .medium).monospacedDigit())
        .foregroundStyle(tone?.color(theme) ?? theme.text).lineLimit(1)
    }
    .accessibilityElement(children: .combine)
  }

  private var diffText: String {
    guard let diff = score.diff else { return "—" }
    return "\(diff.files) files  +\(diff.insertions) −\(diff.deletions)"
  }

  private func runText(_ runs: [CompareRunCommand]) -> String {
    guard let state = CompareSlotScore.summary(runs) else { return "Not run" }
    let label = CompareFormat.label(state)
    return runs.count > 1 ? "\(label) (\(runs.count))" : label
  }

  private func tone(_ runs: [CompareRunCommand]) -> Tone? {
    switch CompareSlotScore.summary(runs) {
    case .failed: .danger
    case .passed: .success
    case .running: .accent
    case nil: nil
    }
  }

  private var statusLabel: String {
    switch score.agentStatus {
    case nil: "Setting up"
    case .running: "Working"
    case .requiresAction: "Needs you"
    case .error: "Failed"
    case .stopped: "Stopped"
    default: "Done"
    }
  }

  private var statusTone: Tone {
    switch score.agentStatus {
    case .running, nil: .accent
    case .requiresAction: .warning
    case .error: .danger
    case .stopped: .muted
    default: .success
    }
  }
}

/// How compare numbers read, shared by every place that shows them.
public enum CompareFormat {
  public static func cost(_ usd: Double) -> String {
    if usd <= 0 { return "—" }
    return usd < 0.01 ? "<$0.01" : String(format: "$%.2f", usd)
  }

  public static func tokens(_ count: Int) -> String {
    switch count {
    case 0: "—"
    case ..<1_000: "\(count)"
    case ..<1_000_000: String(format: "%.1fk", Double(count) / 1_000)
    default: String(format: "%.1fM", Double(count) / 1_000_000)
    }
  }

  public static func label(_ state: CompareRunState) -> String {
    switch state {
    case .running: "Running"
    case .passed: "Passed"
    case .failed: "Failed"
    }
  }
}
