import SwiftUI

/// The icon vocabulary, mapped onto SF Symbols.
///
/// The RN client hand-draws these at stroke weight 1.75; SF Symbols is the
/// native equivalent and gets weight, optical sizing and Dynamic Type for
/// free. Names are kept from the shared vocabulary so a screen reads the same
/// across clients.
public enum Icon {
  public static let chevronRight = "chevron.right"
  public static let chevronDown = "chevron.down"
  public static let chevronLeft = "chevron.left"
  public static let chevronUp = "chevron.up"
  /// A menu that picks one of several, like the computer switcher.
  public static let chevronUpDown = "chevron.up.chevron.down"
  public static let proposal = "lightbulb"
  public static let folder = "folder"
  public static let file = "doc"
  public static let branch = "arrow.triangle.branch"
  public static let merge = "arrow.triangle.merge"
  /// A session stacked on another.
  public static let stacked = "arrow.turn.down.right"
  public static let restack = "arrow.triangle.2.circlepath"
  public static let landStack = "square.stack.3d.down.forward"
  public static let pullRequest = "arrow.triangle.pull"
  public static let push = "arrow.up"
  public static let repo = "shippingbox"
  public static let agent = "sparkle"
  /// Have Claude draft a message.
  public static let draft = "sparkles"
  /// A chat carried on by another runner.
  public static let continueOn = "arrow.forward.circle"
  public static let desktop = "desktopcomputer"
  /// An external drive a project's worktrees can live on.
  public static let drive = "externaldrive"
  public static let trash = "trash"
  public static let gear = "gearshape"
  public static let refresh = "arrow.clockwise"
  public static let simulator = "iphone"
  public static let stop = "stop.circle"
  public static let send = "arrow.up.circle.fill"
  /// A suggested reply to the agent.
  public static let reply = "arrowshape.turn.up.left"
  public static let paperclip = "paperclip"
  public static let mic = "mic"
  public static let micActive = "mic.fill"
  public static let camera = "camera"
  public static let qrCode = "qrcode.viewfinder"
  public static let plus = "plus"
  public static let close = "xmark"
  public static let ellipsis = "ellipsis"
  public static let home = "house"
  public static let arrowBack = "arrow.left"
  public static let keyboard = "keyboard"
  public static let check = "checkmark"
  public static let done = "checkmark.circle"
  public static let snooze = "moon.zzz"
  public static let unsnooze = "sun.max"
  public static let reopen = "arrow.uturn.backward.circle"
  public static let history = "clock.arrow.circlepath"
  public static let search = "magnifyingglass"
  public static let filter = "line.3.horizontal.decrease"
  public static let terminal = "terminal"
  public static let pencil = "pencil"
  /// A new session, as the Mac sidebar's button.
  public static let compose = "square.and.pencil"
  public static let scratchPad = "note.text"
  public static let triage = "stethoscope"
  public static let pin = "pin"
  public static let pinSlash = "pin.slash"
  public static let web = "globe"
  /// Pick an element on screen to attach to the chat.
  public static let elementPick = "cursorarrow.rays"
  public static let eye = "eye"
  public static let eyeSlash = "eye.slash"
  public static let copy = "doc.on.doc"
  public static let download = "square.and.arrow.down"
  public static let share = "square.and.arrow.up"
  public static let lock = "lock"
  public static let clock = "clock"
  public static let envelope = "tray"
  public static let chat = "bubble.left"
  public static let sideQuestion = "bubble.left.and.text.bubble.right"
  public static let play = "play.fill"
  public static let link = "link"
  /// A tracker issue (Linear).
  public static let issue = "checklist"
  /// A Figma frame.
  public static let design = "paintbrush.pointed"
  public static let compare = "square.split.2x1"
  /// A review guide: a tour of a change, stop by stop.
  public static let guide = "map"
  public static let openExternal = "arrow.up.forward.square"
  /// A slash command sent to an agent.
  public static let slashCommand = "slash.circle"
  public static let warning = "exclamationmark.triangle"
  public static let mcp = "server.rack"
  public static let setup = "wrench.and.screwdriver"
  /// A session's details: branch, changes, tools.
  public static let details = "info.circle"
  /// The trailing panel beside a session's chat.
  public static let sidePanel = "sidebar.right"
  public static let image = "photo"
  public static let rotate = "rotate.right"
  public static let fold = "book.closed"
  public static let playPause = "playpause"
  public static let menu = "line.3.horizontal"
  public static let expand = "arrow.up.left.and.arrow.down.right"
  public static let person = "person.crop.circle"
  public static let usage = "gauge.with.dots.needle.33percent"
  public static let price = "dollarsign.circle"
  public static let model = "cpu"
  public static let undo = "arrow.uturn.backward"
  public static let notification = "bell.fill"
  public static let androidBack = "arrow.left"
  public static let androidRecents = "square.on.square"

  // MARK: Destinations — one glyph per screen, read by both apps' navigation.

  public static let projects = "folder"
  public static let inbox = "tray"
  public static let agents = "sparkles"
  public static let automations = "clock.arrow.circlepath"
  public static let devices = "iphone.gen3"
  public static let runtimes = "play.rectangle"
  public static let pullRequests = pullRequest
  public static let issues = issue
  public static let settings = gear
  public static let notifications = "bell"
  /// The phone's tab for every destination without one of its own.
  public static let more = "ellipsis.circle"
  /// A session's uncommitted changes.
  public static let changes = "plusminus"
}
