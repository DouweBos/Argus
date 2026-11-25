/// An input affordance the host can't tell apart from a plain send — what the
/// chat input reports so the app shell can count it.
public enum ChatInputAffordance: String, Sendable {
  case slashCommand = "slash_command"
  case mention
  case imagePaste = "image_paste"
  case imageDrop = "image_drop"
  case imageAttach = "image_attach"
  case fileMention = "file_mention"
  /// A non-image file was picked from the attach button.
  case fileAttach = "file_attach"
  case permissionCycle = "permission_cycle"
  case interruptShortcut = "interrupt_shortcut"
  /// A suggested reply filled the input, by tap, click or Tab.
  case followUp = "follow_up"
  /// A side question's answer sent into the chat.
  case sideAnswerSent = "side_answer_sent"
  /// A start composer's runner was picked.
  case runnerPicked = "runner_picked"
  /// The composer's ⋮ menu was opened.
  case overflowMenu = "overflow_menu"
  /// Dictated words landed in the draft, from the mic button.
  case dictation
  /// Dictated words landed in the draft, from the Mac's hold-to-talk key.
  case dictationShortcut = "dictation_shortcut"
  /// Voice mode was turned on.
  case voiceMode = "voice_mode"
  /// A prompt was sent by pausing after speaking it, in voice mode.
  case voiceSend = "voice_send"
  /// A permission prompt was answered aloud, in voice mode.
  case voiceAnswer = "voice_answer"
  /// `/usage-limits` opened the composer's limits panel.
  case usageLimits = "usage_limits"
}
