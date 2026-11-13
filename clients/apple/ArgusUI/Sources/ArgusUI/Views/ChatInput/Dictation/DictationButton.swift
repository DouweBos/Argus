import SwiftUI

/// The composer's mic: tap to dictate into the draft, tap again to stop.
public struct DictationButton: View {
  @Environment(\.theme) private var theme
  let phase: DictationPhase
  let size: CGFloat
  let help: String
  let action: () -> Void

  public init(phase: DictationPhase, size: CGFloat, help: String = "Dictate", action: @escaping () -> Void) {
    self.phase = phase
    self.size = size
    self.help = help
    self.action = action
  }

  public var body: some View {
    Button(action: action) {
      label
        .symbolEffect(.pulse, options: .repeating, isActive: phase == .listening)
        .opacity(phase == .starting || phase == .finishing ? 0.5 : 1)
    }
    .buttonStyle(FlatIconButtonStyle(selected: phase.isActive, size: size))
    .help(phase.isActive ? "Stop dictating" : help)
  }

  /// Accent while the microphone is open; otherwise the flat button's own hover colours.
  @ViewBuilder private var label: some View {
    if phase.isActive {
      // On the image itself: the flat button style colours its whole label.
      Label {
        Text("Stop dictating")
      } icon: {
        Image(systemName: Icon.micActive).foregroundStyle(theme.accent)
      }
    } else {
      Label("Dictate", systemImage: Icon.mic)
    }
  }
}

/// The draft's placeholder while the microphone is open.
extension DictationPhase {
  var placeholder: String? {
    switch self {
    case .starting: "Getting ready…"
    case .listening: "Listening…"
    case .finishing: "Finishing…"
    case .idle, .failed: nil
    }
  }

  var failure: String? {
    if case .failed(let message) = self { return message }
    return nil
  }
}
