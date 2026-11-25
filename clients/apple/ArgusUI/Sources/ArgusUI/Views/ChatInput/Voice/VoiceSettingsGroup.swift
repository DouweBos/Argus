import ArgusKit
import SwiftUI

/// Voice mode's voice, speed and when it speaks; the same group on the Mac and the phone.
public struct VoiceSettingsGroup: View {
  @Environment(\.theme) private var theme
  @State private var settings: VoiceSettings
  @State private var voices: [(id: String, name: String)] = []
  @State private var preview: SystemSpeechSynthesizer?
  private let preferences: Preferences

  public init(preferences: Preferences = Preferences()) {
    self.preferences = preferences
    _settings = State(initialValue: VoiceSettings.load(preferences))
  }

  public var body: some View {
    SettingsGroup(
      "Voice mode",
      footer: "Turn voice mode on with the waveform button in the message field. Replies are read aloud and "
        + "the microphone opens; pause to send. Answer permission prompts with \u{201C}allow\u{201D} "
        + "or \u{201C}deny\u{201D}. Speech stays on this device."
    ) {
      SettingsRow("Voice", description: "Download more voices in the system's Spoken Content settings.") {
        Picker("Voice", selection: $settings.voiceId) {
          Text("System voice").tag(String?.none)
          ForEach(voices, id: \.id) { Text($0.name).tag(Optional($0.id)) }
        }
        .pickerStyle(.menu)
      }
      SettingsRow("Speed", stacked: true) {
        HStack(spacing: 12) {
          Slider(value: $settings.speed, in: VoiceSettings.speeds, step: 0.1)
          Text(settings.speed.formatted(.number.precision(.fractionLength(1))) + "\u{00D7}")
            .font(.scaled(size: 12).monospacedDigit())
            .foregroundStyle(theme.textSecondary)
          Btn(label: "Preview", tone: .secondary, small: true, hugs: true, action: play)
        }
      }
      SettingsRow(
        "Send after a pause of", description: "Longer gives you time to think mid-sentence.", stacked: true
      ) {
        HStack(spacing: 12) {
          Slider(value: $settings.sendAfter, in: VoiceSettings.sendAfterRange, step: 0.5)
          Text(settings.sendAfter.formatted(.number.precision(.fractionLength(1))) + " s")
            .font(.scaled(size: 12).monospacedDigit())
            .foregroundStyle(theme.textSecondary)
        }
      }
      SettingsToggleRow(
        "Only speak in the background",
        description: "While Argus is in front, replies stay on screen and the microphone still opens.",
        isOn: $settings.onlyInBackground)
    }
    .task { voices = VoiceSettings.voices() }
    .onChange(of: settings) { _, next in next.save(preferences) }
  }

  private func play() {
    let synthesizer = preview ?? SystemSpeechSynthesizer()
    preview = synthesizer
    let settings = settings
    Task { await synthesizer.speak("The tests pass. Want me to open a pull request?", settings: settings) }
  }
}
