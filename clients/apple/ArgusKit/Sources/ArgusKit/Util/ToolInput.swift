import Foundation

/// One labelled value from a tool's input.
public struct ToolInputField: Sendable, Hashable, Identifiable {
  /// Human-readable path: `file_path`, `edits 1 · old_string`.
  public var label: String
  public var value: String
  /// Worth its own block rather than a line: code, prose, anything wrapped.
  public var isLong: Bool
  public var id: String { label }

  public init(label: String, value: String, isLong: Bool) {
    self.label = label
    self.value = value
    self.isLong = isLong
  }
}

/// Tool inputs, flattened into labelled values.
///
/// Nothing is ever shown as raw JSON: braces and quotes are noise around the
/// two things worth reading — which field, and what is in it. Nested objects
/// and arrays flatten into a path so even an unknown tool reads as a list.
public enum ToolInput {
  /// Past this a value gets its own block instead of sitting on the label's line.
  private static let longValueChars = 48

  public static func fields(_ input: [String: JSONValue]) -> [ToolInputField] {
    var out: [ToolInputField] = []
    for key in input.keys.sorted() {
      append(label: key, value: input[key] ?? .null, into: &out)
    }
    return out
  }

  private static func append(
    label: String, value: JSONValue, into out: inout [ToolInputField]
  ) {
    switch value {
    case .object(let fields) where !fields.isEmpty:
      for key in fields.keys.sorted() {
        append(label: "\(label) · \(key)", value: fields[key] ?? .null, into: &out)
      }
    case .array(let items) where !items.isEmpty:
      for (index, item) in items.enumerated() {
        append(label: "\(label) \(index + 1)", value: item, into: &out)
      }
    default:
      let text = scalar(value)
      out.append(
        ToolInputField(
          label: label, value: text,
          isLong: text.count > longValueChars || text.contains("\n")))
    }
  }

  /// A leaf, and the two empty containers that have nothing to descend into.
  private static func scalar(_ value: JSONValue) -> String {
    switch value {
    case .string(let text): return text
    case .bool(let flag): return flag ? "true" : "false"
    case .number(let number):
      return number == number.rounded() && abs(number) < 1e15
        ? String(Int(number)) : String(number)
    case .null: return "none"
    case .array: return "none"
    case .object: return "none"
    }
  }
}
