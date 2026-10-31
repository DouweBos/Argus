import ArgusCore

extension SessionActivity.State {
  public var tone: Tone {
    switch self {
    case .failed: .danger
    case .waiting: .warning
    case .working: .accent
    case .unavailable, .preparing, .idle: .muted
    }
  }
}

extension SessionActivity {
  public var tone: Tone { state.tone }
}
