import ArgusUI
import SwiftUI

/// The one-time consent step, mirroring the desktop's onboarding telemetry
/// step: the same two choices, in the same words. Shown once per install;
/// Settings → Privacy is where it changes afterwards.
struct TelemetryConsentSheet: View {
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Screen {
        TitleText("Help improve Argus")
        MutedText(
          "Pick how much you want to share. You can change this any time under Settings → Privacy.")

        Card {
          BodyText("Just count me")
          MutedText("One event per launch — a random install id and the app version, nothing else.")
          MutedText("This is the minimum; Argus always sends this heartbeat.")
        }

        Card {
          BodyText("Share anonymous data")
          MutedText("App version, iOS version and device model.")
          MutedText("Which screens you open and which actions you take.")
          MutedText("Crashes and errors, with file paths stripped out.")
        }

        Card {
          BodyText("What we never collect")
          MutedText("Prompts, agent output, project names, branch names or repo paths.")
          MutedText("Your device name, or anything that identifies you or your computers.")
        }

        VStack(spacing: 8) {
          Btn(label: "Share anonymous data") { choose(.full) }
          Btn(label: "Just count me", tone: .secondary) { choose(.presence) }
        }
        .frame(maxWidth: .infinity)
      }
      .navigationTitle("Privacy")
      .navigationBarTitleDisplayMode(.inline)
    }
    // Answering is the point of the sheet, so there is no way to swipe past it.
    .interactiveDismissDisabled()
  }

  private func choose(_ mode: TelemetryMode) {
    Telemetry.setMode(mode)
    dismiss()
  }
}
