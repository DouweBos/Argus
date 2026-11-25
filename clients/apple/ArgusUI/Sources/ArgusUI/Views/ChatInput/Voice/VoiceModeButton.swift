import SwiftUI

/// The composer's voice mode switch: on, replies are read aloud and the conversation runs hands-free.
public struct VoiceModeButton: View {
  @Environment(\.theme) private var theme
  let isOn: Bool
  let speaking: Bool
  let size: CGFloat
  let action: () -> Void

  public init(isOn: Bool, speaking: Bool, size: CGFloat, action: @escaping () -> Void) {
    self.isOn = isOn
    self.speaking = speaking
    self.size = size
    self.action = action
  }

  public var body: some View {
    Button(action: action) { label.symbolEffect(.variableColor.iterative, options: .repeating, isActive: speaking) }
    .buttonStyle(FlatIconButtonStyle(selected: isOn, size: size))
    .help(isOn ? "Turn off voice mode" : "Voice mode: hear replies and answer by talking")
    .accessibilityAddTraits(isOn ? .isSelected : [])
  }

  /// Accent while on; otherwise the flat button's own hover colours.
  @ViewBuilder private var label: some View {
    if isOn {
      // On the image itself: the flat button style colours its whole label.
      Label {
        Text("Turn off voice mode")
      } icon: {
        Image(systemName: Icon.voiceMode).foregroundStyle(theme.accent)
      }
    } else {
      Label("Voice mode", systemImage: Icon.voiceMode)
    }
  }
}

extension View {
  /// Feeds voice mode the turns and prompts it reacts to.
  func voiceLoop(_ composer: ComposerModel) -> some View {
    onChange(of: composer.isRunning) { _, running in
      if running { composer.voiceTurnStarted() }
    }
    .onChange(of: composer.voiceCue) { _, _ in composer.voiceCueChanged() }
    .onDisappear { composer.stopVoice() }
  }
}
