/// An input affordance the host can't tell apart from a plain send — what the
/// chat input reports so the app shell can count it.
public enum ChatInputAffordance: String, Sendable {
  case slashCommand = "slash_command"
  case mention
  case imagePaste = "image_paste"
  case imageDrop = "image_drop"
  case imageAttach = "image_attach"
  case fileMention = "file_mention"
  case permissionCycle = "permission_cycle"
  case interruptShortcut = "interrupt_shortcut"
}
