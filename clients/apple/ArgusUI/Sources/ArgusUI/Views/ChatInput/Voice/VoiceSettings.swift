@preconcurrency import AVFoundation
import ArgusKit
import Foundation

/// How voice mode speaks, per device.
public struct VoiceSettings: Codable, Equatable, Sendable {
  /// An `AVSpeechSynthesisVoice` identifier; nil is the system's voice for the current language.
  public var voiceId: String?
  /// A multiple of the system's normal speaking rate.
  public var speed: Double
  /// Stay quiet while Argus is in front, and only listen.
  public var onlyInBackground: Bool

  public static let `default` = VoiceSettings(voiceId: nil, speed: 1, onlyInBackground: false)
  public static let speeds: ClosedRange<Double> = 0.5...2

  public init(voiceId: String?, speed: Double, onlyInBackground: Bool) {
    self.voiceId = voiceId
    self.speed = speed
    self.onlyInBackground = onlyInBackground
  }

  static let key = "voice.settings"
  static let modeKey = "voice.mode"

  public static func load(_ preferences: Preferences = Preferences()) -> VoiceSettings {
    preferences.decode(key, as: VoiceSettings.self) ?? .default
  }

  public func save(_ preferences: Preferences = Preferences()) { preferences.encode(self, for: Self.key) }

  /// Voice mode is one switch for the whole app, not per agent.
  static func isModeOn(_ preferences: Preferences) -> Bool { preferences.string(modeKey) == "on" }
  static func setMode(_ on: Bool, _ preferences: Preferences) { preferences.set(on ? "on" : nil, for: modeKey) }

  /// The installed voices for the current language, best quality first.
  public static func voices() -> [(id: String, name: String)] {
    let language = Locale.current.language.languageCode?.identifier ?? "en"
    return AVSpeechSynthesisVoice.speechVoices()
      .filter { $0.language.hasPrefix(language) }
      .sorted { ($0.quality.rawValue, $1.name) > ($1.quality.rawValue, $0.name) }
      .map { (id: $0.identifier, name: Self.label($0)) }
  }

  private static func label(_ voice: AVSpeechSynthesisVoice) -> String {
    let region = Locale.current.localizedString(forIdentifier: voice.language) ?? voice.language
    let quality =
      switch voice.quality {
      case .premium: " (Premium)"
      case .enhanced: " (Enhanced)"
      default: ""
      }
    return "\(voice.name)\(quality), \(region)"
  }
}
