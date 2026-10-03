import AppKit
import SwiftTerm

/// The desktop app's terminal palettes (`app/hooks/useTerminal.ts`), so a
/// shell looks the same in both apps.
struct TerminalPalette {
  let background: UInt32
  let foreground: UInt32
  let cursor: UInt32
  let selection: UInt32
  /// black, red, green, yellow, blue, magenta, cyan, white, then the brights.
  let ansi: [UInt32]

  static let dark = TerminalPalette(
    background: 0x202020, foreground: 0xe8e8e8, cursor: 0x509050, selection: 0x383838,
    ansi: [
      0x303030, 0xa05050, 0x509050, 0xb8a050, 0x5a8ab0, 0xa06090, 0x509090, 0xb0b0b0,
      0x505050, 0xa05050, 0x509050, 0xb8a050, 0x5a8ab0, 0xa06090, 0x509090, 0xe8e8e8,
    ])

  static let light = TerminalPalette(
    background: 0xffffff, foreground: 0x0d0d14, cursor: 0x00704a, selection: 0xd0d3da,
    ansi: [
      0x2f2f40, 0xb3261e, 0x00704a, 0x8a6300, 0x1f5ea8, 0x8a3a80, 0x0f6b78, 0x5c5c72,
      0x5c5c72, 0xc53030, 0x0b8a5c, 0xa67400, 0x2a6fc0, 0xa14a98, 0x177c8c, 0x0d0d14,
    ])

  func apply(to view: TerminalView) {
    view.installColors(ansi.map(Self.terminalColor))
    view.nativeBackgroundColor = Self.nsColor(background)
    view.nativeForegroundColor = Self.nsColor(foreground)
    view.caretColor = Self.nsColor(cursor)
    view.selectedTextBackgroundColor = Self.nsColor(selection)
  }

  private static func terminalColor(_ rgb: UInt32) -> SwiftTerm.Color {
    SwiftTerm.Color(
      red8: UInt16(rgb >> 16 & 0xff), green8: UInt16(rgb >> 8 & 0xff), blue8: UInt16(rgb & 0xff))
  }

  private static func nsColor(_ rgb: UInt32) -> NSColor {
    NSColor(
      srgbRed: CGFloat(rgb >> 16 & 0xff) / 255, green: CGFloat(rgb >> 8 & 0xff) / 255,
      blue: CGFloat(rgb & 0xff) / 255, alpha: 1)
  }
}
