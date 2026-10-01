import Foundation

// The few JavaScript behaviours the ported reducer leans on, reproduced so its
// output matches the renderer's byte for byte where it can.
enum JS {
  static func isTruthy(_ v: JSONValue?) -> Bool {
    switch v {
    case nil, .null?: return false
    case .bool(let b)?: return b
    case .number(let n)?: return n != 0 && !n.isNaN
    case .string(let s)?: return !s.isEmpty
    case .array?, .object?: return true
    }
  }

  /// `Number.prototype.toString`.
  static func number(_ n: Double) -> String {
    if n.isNaN { return "NaN" }
    if n.isInfinite { return n < 0 ? "-Infinity" : "Infinity" }
    if n == n.rounded(), abs(n) < 1e21 {
      return abs(n) < 9e15 ? String(Int64(n)) : String(format: "%.0f", n)
    }
    // Swift prints exponents as "1e-07"; JS prints "1e-7".
    var s = "\(n)"
    if let e = s.range(of: "e-0") { s.replaceSubrange(e, with: "e-") }
    return s
  }

  /// Template-literal interpolation (`${v}`).
  static func interpolate(_ v: JSONValue?) -> String {
    switch v {
    case nil: return "undefined"
    case .null?: return "null"
    case .bool(let b)?: return b ? "true" : "false"
    case .number(let n)?: return number(n)
    case .string(let s)?: return s
    case .array(let a)?: return a.map { $0 == .null ? "" : interpolate($0) }.joined(separator: ",")
    case .object?: return "[object Object]"
    }
  }

  /// `JSON.stringify(v, null, indent)`. Object keys come out sorted: `JSONValue`
  /// doesn't keep insertion order, which is the one place this can differ.
  static func stringify(_ v: JSONValue, indent: Int = 0) -> String {
    var out = ""
    write(v, indent: indent, depth: 0, into: &out)
    return out
  }

  private static func write(_ v: JSONValue, indent: Int, depth: Int, into out: inout String) {
    let pad = { (d: Int) in indent > 0 ? "\n" + String(repeating: " ", count: indent * d) : "" }
    switch v {
    case .null: out += "null"
    case .bool(let b): out += b ? "true" : "false"
    case .number(let n): out += n.isFinite ? number(n) : "null"
    case .string(let s): out += quote(s)
    case .array(let a):
      if a.isEmpty { out += "[]"; return }
      out += "["
      for (i, el) in a.enumerated() {
        if i > 0 { out += "," }
        out += pad(depth + 1)
        write(el, indent: indent, depth: depth + 1, into: &out)
      }
      out += pad(depth) + "]"
    case .object(let o):
      if o.isEmpty { out += "{}"; return }
      out += "{"
      for (i, key) in o.keys.sorted().enumerated() {
        if i > 0 { out += "," }
        out += pad(depth + 1) + quote(key) + (indent > 0 ? ": " : ":")
        write(o[key]!, indent: indent, depth: depth + 1, into: &out)
      }
      out += pad(depth) + "}"
    }
  }

  private static func quote(_ s: String) -> String {
    var out = "\""
    for u in s.unicodeScalars {
      switch u {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\u{08}": out += "\\b"
      case "\u{0C}": out += "\\f"
      case "\n": out += "\\n"
      case "\r": out += "\\r"
      case "\t": out += "\\t"
      case _ where u.value < 0x20: out += String(format: "\\u%04x", u.value)
      default: out.unicodeScalars.append(u)
      }
    }
    return out + "\""
  }

  /// `JSON.parse`, or nil where it would throw.
  static func parse(_ text: String) -> JSONValue? {
    try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
  }

  /// `String.prototype.trim` whitespace.
  static func trim(_ s: String) -> String {
    s.trimmingCharacters(in: .whitespacesAndNewlines.union(["\u{FEFF}"]))
  }
}

extension JSONValue {
  var numberValue: Double? {
    if case .number(let n) = self { return n }
    return nil
  }

  var boolValue: Bool? {
    if case .bool(let b) = self { return b }
    return nil
  }
}
