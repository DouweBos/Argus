import SwiftUI

/// The icon vocabulary, mapped onto SF Symbols.
///
/// The RN client hand-draws these at stroke weight 1.75; SF Symbols is the
/// native equivalent and gets weight, optical sizing and Dynamic Type for
/// free. Names are kept from the shared vocabulary so a screen reads the same
/// across clients.
enum Icon {
  static let chevronRight = "chevron.right"
  static let chevronDown = "chevron.down"
  static let chevronLeft = "chevron.left"
  static let folder = "folder"
  static let file = "doc"
  static let branch = "arrow.triangle.branch"
  static let repo = "shippingbox"
  static let agent = "sparkle"
  static let desktop = "desktopcomputer"
  static let trash = "trash"
  static let gear = "gearshape"
  static let refresh = "arrow.clockwise"
  static let simulator = "iphone"
  static let stop = "stop.circle"
  static let send = "arrow.up.circle.fill"
  static let paperclip = "paperclip"
  static let camera = "camera"
  static let plus = "plus"
  static let close = "xmark"
  static let ellipsis = "ellipsis"
  static let home = "house"
  static let arrowBack = "arrow.left"
  static let keyboard = "keyboard"
  static let check = "checkmark"
  static let history = "clock.arrow.circlepath"
  static let search = "magnifyingglass"
  static let terminal = "terminal"
  static let pencil = "pencil"
  static let web = "globe"
  static let eye = "eye"
  static let lock = "lock"
  static let clock = "clock"
  static let envelope = "tray"
  static let play = "play.fill"
  static let link = "link"
  static let warning = "exclamationmark.triangle"
  static let image = "photo"
  static let androidBack = "arrow.left"
  static let androidRecents = "square.on.square"
}
