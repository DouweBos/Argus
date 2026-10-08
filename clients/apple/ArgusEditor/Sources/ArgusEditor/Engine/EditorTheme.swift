import ArgusSyntax
import AppKit
import ArgusUI
import SwiftUI

/// `Theme` resolved to the AppKit colours the engine draws with.
struct EditorTheme {
  var scheme: ColorScheme
  var background: NSColor
  var text: NSColor
  var currentLine: NSColor
  var selection: NSColor
  var insertionPoint: NSColor
  var lineNumber: NSColor
  var lineNumberActive: NSColor
  var added: NSColor
  var modified: NSColor
  var deleted: NSColor
  var error: NSColor
  var warning: NSColor
  var info: NSColor
  var flash: NSColor
  var invisible: NSColor
  private var syntaxColors: [SyntaxCapture: NSColor]
  /// The SwiftUI theme this came from, for the popovers.
  let base: Theme

  init(_ theme: Theme) {
    base = theme
    syntaxColors = Dictionary(uniqueKeysWithValues: SyntaxCapture.allCases.map { ($0, NSColor(theme.syntaxColor($0))) })
    scheme = theme.scheme
    background = NSColor(theme.bg)
    text = NSColor(theme.text)
    currentLine = NSColor(theme.bgHover)
    selection = NSColor(theme.accent).withAlphaComponent(0.28)
    insertionPoint = NSColor(theme.accent)
    lineNumber = NSColor(theme.textMuted)
    lineNumberActive = NSColor(theme.textSecondary)
    added = NSColor(theme.success)
    modified = NSColor(theme.warning)
    deleted = NSColor(theme.error)
    error = NSColor(theme.error)
    warning = NSColor(theme.warning)
    info = NSColor(theme.accent)
    flash = NSColor(theme.accent).withAlphaComponent(0.22)
    invisible = NSColor(theme.textMuted).withAlphaComponent(0.6)
  }

  func syntax(_ capture: SyntaxCapture) -> NSColor {
    syntaxColors[capture] ?? text
  }

  func severity(_ severity: DiagnosticSeverity) -> NSColor {
    switch severity {
    case .error: error
    case .warning: warning
    case .info, .hint: info
    }
  }

  static let `default` = EditorTheme(.dark)
}
