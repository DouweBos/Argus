import ArgusKit
import Foundation

/// Quick open's `@` before a language server answers: the declarations in a buffer, found by
/// keyword (`class`, `func`, `def`, `fn`, …) in any language, nested by indentation. Rougher
/// than the host's per-language index, but it reads unsaved text.
public enum BufferSymbolScanner {
  private static let pattern = try! NSRegularExpression(
    pattern:
      #"^([ \t]*)(?:[@\w().\-]+[ \t]+)*?(class|struct|enum|protocol|extension|actor|interface|trait|impl|object|module|namespace|typealias|type|func|function|def|fun|fn)[ \t]*\*?[ \t]+`?([A-Za-z_$][\w$.]*)"#,
    options: [.anchorsMatchLines])

  private static let kinds: [String: ArgusProtocol.CodeSymbolKind] = [
    "class": .class, "actor": .class, "object": .class, "struct": .struct, "enum": .enum,
    "protocol": .protocol, "interface": .interface, "trait": .interface, "extension": .extension,
    "impl": .extension, "module": .module, "namespace": .module, "typealias": .typeAlias, "type": .typeAlias,
    "func": .function, "function": .function, "def": .function, "fun": .function, "fn": .function,
  ]

  private struct Frame {
    let indent: Int
    let name: String
    let isType: Bool
  }

  public static func symbols(in text: String, path: String) -> [ArgusProtocol.CodeSymbol] {
    let source = text as NSString
    var out: [ArgusProtocol.CodeSymbol] = []
    var stack: [Frame] = []
    var lineNumber = 1
    var lineStart = 0
    for match in pattern.matches(in: text, range: NSRange(location: 0, length: source.length)) {
      // Count the line breaks between the last match and this one.
      let start = match.range.location
      lineNumber += countLines(source, from: lineStart, to: start)
      lineStart = start
      let indent = match.range(at: 1).length
      let keyword = source.substring(with: match.range(at: 2))
      let nameRange = match.range(at: 3)
      let name = source.substring(with: nameRange)
      guard var kind = kinds[keyword] else { continue }
      while let top = stack.last, top.indent >= indent { stack.removeLast() }
      let parent = stack.last
      if kind == .function, parent?.isType == true { kind = .method }
      let isType = kind != .function && kind != .method
      if keyword != "impl", parent == nil || parent?.isType == true {
        out.append(
          ArgusProtocol.CodeSymbol(
            name: name, kind: kind, container: parent?.name, relativePath: path, line: lineNumber,
            column: nameRange.location - start))
      }
      stack.append(Frame(indent: indent, name: name, isType: isType))
    }
    return out
  }

  private static func countLines(_ text: NSString, from: Int, to: Int) -> Int {
    var count = 0
    var index = from
    while index < to {
      if text.character(at: index) == 0x0A { count += 1 }
      index += 1
    }
    return count
  }
}
