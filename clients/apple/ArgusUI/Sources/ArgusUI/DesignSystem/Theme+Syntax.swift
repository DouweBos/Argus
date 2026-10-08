import ArgusSyntax
import SwiftUI

#if canImport(UIKit)
  import UIKit

  public typealias PlatformColor = UIColor
#elseif canImport(AppKit)
  import AppKit

  public typealias PlatformColor = NSColor
#endif

/// Syntax colours, one per `SyntaxCapture`. The Mac editor, the iOS viewer and chat code blocks
/// all draw from here; tuned against `Theme`'s accent and status palette in both schemes.
public struct SyntaxPalette: Sendable, Equatable {
  public var keyword, string, comment, type, function, number, constant, variable, property,
    `operator`, punctuation, tag, attribute, escape, regex, heading, link: Color

  public static let dark = SyntaxPalette(
    keyword: Color(hex: 0xB59CFF), string: Color(hex: 0x9CDB8F), comment: Color(hex: 0x7A8290),
    type: Color(hex: 0x5CCFE6), function: Color(hex: 0x82AAFF), number: Color(hex: 0xFFB454),
    constant: Color(hex: 0xF78C6C), variable: Color(hex: 0xE4E4EA), property: Color(hex: 0x7FD8C4),
    operator: Color(hex: 0x89DDFF), punctuation: Color(hex: 0x9BA1AD), tag: Color(hex: 0xFF6B8B),
    attribute: Color(hex: 0xFFCB6B), escape: Color(hex: 0xFF9CAC), regex: Color(hex: 0xF07178),
    heading: Color(hex: 0xF5A623), link: Color(hex: 0x5CCFE6))

  public static let light = SyntaxPalette(
    keyword: Color(hex: 0x8E3CCB), string: Color(hex: 0x3A7D22), comment: Color(hex: 0x6B7280),
    type: Color(hex: 0x0B7A8F), function: Color(hex: 0x2457C5), number: Color(hex: 0xB25E00),
    constant: Color(hex: 0xC2410C), variable: Color(hex: 0x1F2328), property: Color(hex: 0x0F766E),
    operator: Color(hex: 0x0E7490), punctuation: Color(hex: 0x57606A), tag: Color(hex: 0xC21E56),
    attribute: Color(hex: 0xA16207), escape: Color(hex: 0xB4235A), regex: Color(hex: 0xB42318),
    heading: Color(hex: 0xB4690E), link: Color(hex: 0x0B7A8F))

  public func color(_ capture: SyntaxCapture) -> Color {
    switch capture {
    case .keyword: keyword
    case .string, .code: string
    case .comment: comment
    case .type: type
    case .function: function
    case .number: number
    case .constant: constant
    case .variable, .emphasis, .strong: variable
    case .property: property
    case .operator: `operator`
    case .punctuation: punctuation
    case .tag: tag
    case .attribute: attribute
    case .escape: escape
    case .regex: regex
    case .heading: heading
    case .link: link
    }
  }
}

extension Theme {
  public var syntax: SyntaxPalette { scheme == .light ? .light : .dark }

  public var syntaxKeyword: Color { syntax.keyword }
  public var syntaxString: Color { syntax.string }
  public var syntaxComment: Color { syntax.comment }
  public var syntaxType: Color { syntax.type }
  public var syntaxFunction: Color { syntax.function }
  public var syntaxNumber: Color { syntax.number }
  public var syntaxConstant: Color { syntax.constant }
  public var syntaxVariable: Color { syntax.variable }
  public var syntaxProperty: Color { syntax.property }
  public var syntaxOperator: Color { syntax.operator }
  public var syntaxPunctuation: Color { syntax.punctuation }
  public var syntaxTag: Color { syntax.tag }
  public var syntaxAttribute: Color { syntax.attribute }
  public var syntaxEscape: Color { syntax.escape }
  public var syntaxRegex: Color { syntax.regex }
  public var syntaxHeading: Color { syntax.heading }
  public var syntaxLink: Color { syntax.link }

  public func syntaxColor(_ capture: SyntaxCapture) -> Color { syntax.color(capture) }

  /// The same colour for TextKit/CoreText drawing (the Mac editor).
  public func syntaxPlatformColor(_ capture: SyntaxCapture) -> PlatformColor {
    PlatformColor(syntaxColor(capture))
  }
}

extension SyntaxCapture {
  /// Captures that change weight or slant as well as colour.
  public var isBold: Bool { self == .heading || self == .strong }
  public var isItalic: Bool { self == .emphasis }
}
