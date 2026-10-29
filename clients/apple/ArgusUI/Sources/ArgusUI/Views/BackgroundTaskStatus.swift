import ArgusCore
import SwiftUI

public enum BackgroundTaskText {
  /// "Running · 4m 12s", "Done in 18m 41s", "Failed after 3s", "Stopped after 1m 0s".
  public static func label(_ task: RemoteBackgroundTask, now: Date) -> String {
    switch task.status {
    case .running:
      return "Running · \(ChromeText.duration(now.timeIntervalSince1970 - task.startedAt / 1000))"
    case .completed:
      return "Done in \(took(task))"
    case .failed:
      return "Failed after \(took(task))"
    case .stopped:
      return "Stopped after \(took(task))"
    }
  }

  private static func took(_ task: RemoteBackgroundTask) -> String {
    ChromeText.duration((task.durationMs ?? 0) / 1000)
  }
}

/// How a call launched with `run_in_background` is getting on: a live timer
/// while it runs, then how long it took.
public struct BackgroundTaskStatus: View {
  @Environment(\.theme) private var theme
  let task: RemoteBackgroundTask

  public init(task: RemoteBackgroundTask) {
    self.task = task
  }

  public var body: some View {
    Group {
      if task.status == .running {
        TimelineView(.periodic(from: .now, by: 1)) { context in
          Text(BackgroundTaskText.label(task, now: context.date))
        }
      } else {
        Text(BackgroundTaskText.label(task, now: .now))
      }
    }
    .font(.scaled(size: 11).monospacedDigit())
    .foregroundStyle(color)
    .lineLimit(1)
    .fixedSize()
  }

  private var color: Color {
    switch task.status {
    case .running: theme.accent
    case .failed: theme.error
    case .completed, .stopped: theme.textMuted
    }
  }
}
