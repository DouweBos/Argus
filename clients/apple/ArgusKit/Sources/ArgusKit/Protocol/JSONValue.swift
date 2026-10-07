import Foundation

/// A decoded JSON value of unknown shape.
///
/// Tool inputs and results are `Record<string, unknown>` on the wire — the
/// gateway passes them through so the user can see what they are approving.
/// Nothing here interprets them beyond rendering, so a faithful dynamic value
/// is the honest representation.
public indirect enum JSONValue: Codable, Hashable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() {
      self = .null
    } else if let v = try? c.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? c.decode(Double.self) {
      self = .number(v)
    } else if let v = try? c.decode(String.self) {
      self = .string(v)
    } else if let v = try? c.decode([JSONValue].self) {
      self = .array(v)
    } else if let v = try? c.decode([String: JSONValue].self) {
      self = .object(v)
    } else {
      throw DecodingError.dataCorruptedError(
        in: c, debugDescription: "unrepresentable JSON value")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .string(let v): try c.encode(v)
    case .array(let v): try c.encode(v)
    case .object(let v): try c.encode(v)
    }
  }

  // Accessors the UI needs when summarising a tool call.

  public var stringValue: String? {
    if case .string(let s) = self { return s }
    return nil
  }

  public var numberValue: Double? {
    if case .number(let n) = self { return n }
    return nil
  }

  public var boolValue: Bool? {
    if case .bool(let b) = self { return b }
    return nil
  }

  public var intValue: Int? {
    if case .number(let d) = self { return Int(d) }
    return nil
  }

  public var arrayValue: [JSONValue]? {
    if case .array(let a) = self { return a }
    return nil
  }

  public var objectValue: [String: JSONValue]? {
    if case .object(let o) = self { return o }
    return nil
  }

  public subscript(key: String) -> JSONValue? {
    objectValue?[key]
  }
}
