package dev.houwert.argus.ui.composer

/** An input affordance the host can't tell apart from a plain send, reported so the app shell can count it. */
enum class ChatInputAffordance(val rawValue: String) {
  SlashCommand("slash_command"),
  Mention("mention"),
  ImagePaste("image_paste"),
  ImageDrop("image_drop"),
  ImageAttach("image_attach"),
  FileMention("file_mention"),
  /** A non-image file was picked from the attach button. */
  FileAttach("file_attach"),
  PermissionCycle("permission_cycle"),
  InterruptShortcut("interrupt_shortcut"),
  /** A suggested reply filled the input, by tap or Tab. */
  FollowUp("follow_up"),
  /** A side question's answer sent into the chat. */
  SideAnswerSent("side_answer_sent"),
  /** A start composer's runner was picked. */
  RunnerPicked("runner_picked"),
  /** Dictated words landed in the draft, from the mic button. */
  Dictation("dictation"),
  /** Dictated words landed in the draft, from a hold-to-talk key. */
  DictationShortcut("dictation_shortcut"),
  /** `/usage-limits` opened the composer's limits panel. */
  UsageLimits("usage_limits"),
}
