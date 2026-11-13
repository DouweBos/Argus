import ArgusKit
import Foundation

/// The price editor's rows, as typed: hand-set prices first, then recently
/// used list-priced models with their list price as the placeholder.
public struct UsagePriceDraft: Equatable, Sendable {
  public struct Row: Equatable, Sendable, Identifiable {
    public var id: String { model }
    public let model: String
    public var input: String
    public var output: String
    public var cacheRead: String
    public var cacheWrite: String
    public var mapTo: String
    /// What the model costs without a hand-set price.
    public let list: ListRates?
    /// Marked "Reset to automatic"; undoable until saved.
    public var resetting = false

    public init(model: String, list: ListRates?) {
      self.model = model
      self.list = list
      input = ""
      output = ""
      cacheRead = ""
      cacheWrite = ""
      mapTo = ""
    }

    /// Anything typed: what makes the row an override.
    public var isSet: Bool {
      !resetting && [input, output, cacheRead, cacheWrite, mapTo].contains { !$0.trimmed.isEmpty }
    }

    public var isMapped: Bool { !mapTo.trimmed.isEmpty }
  }

  /// A list price per million tokens.
  public struct ListRates: Equatable, Sendable {
    public let input, output, cacheRead, cacheWrite: Double

    init(_ price: ArgusProtocol.UsageListPrice) {
      input = price.inputPerMtok
      output = price.outputPerMtok
      cacheRead = price.cacheReadPerMtok
      cacheWrite = price.cacheWritePerMtok
    }
  }

  public private(set) var rows: [Row]
  private let saved: [Row]

  public init(prices: ArgusProtocol.UsagePrices, adding model: String? = nil) {
    let lists = Dictionary(prices.list.map { ($0.model, ListRates($0)) }, uniquingKeysWith: { first, _ in first })
    var rows = prices.overrides.map { override in
      var row = Row(model: override.model, list: lists[override.model])
      row.input = Self.text(override.inputPerMtok)
      row.output = Self.text(override.outputPerMtok)
      row.cacheRead = Self.text(override.cacheReadPerMtok)
      row.cacheWrite = Self.text(override.cacheWritePerMtok)
      row.mapTo = override.mapTo ?? ""
      return row
    }
    let known = Set(rows.map(\.model))
    rows += prices.list.filter { !known.contains($0.model) }.map { Row(model: $0.model, list: ListRates($0)) }
    saved = rows
    self.rows = rows
    if let model { add(model) }
  }

  public var isDirty: Bool { rows != saved }

  public subscript(model: String) -> Row? {
    get { rows.first { $0.model == model } }
    set {
      guard let index = rows.firstIndex(where: { $0.model == model }), let newValue else { return }
      rows[index] = newValue
    }
  }

  /// Adds a model by id at the top; one already listed stays where it is.
  @discardableResult
  public mutating func add(_ model: String) -> Bool {
    let model = model.trimmed
    guard !model.isEmpty, self[model] == nil else { return false }
    rows.insert(Row(model: model, list: nil), at: 0)
    return true
  }

  public mutating func toggleReset(_ model: String) {
    self[model]?.resetting.toggle()
  }

  /// The overrides to save, or why a field can't be read as a price.
  public func overrides() -> Result<[ArgusProtocol.UsagePriceOverride], DraftError> {
    var out: [ArgusProtocol.UsagePriceOverride] = []
    for row in rows where row.isSet {
      if row.isMapped {
        out.append(.init(model: row.model, mapTo: row.mapTo.trimmed))
        continue
      }
      var prices: [Double?] = []
      for (field, value) in [("input", row.input), ("output", row.output), ("cache read", row.cacheRead), ("cache write", row.cacheWrite)] {
        let raw = value.trimmed
        if raw.isEmpty {
          prices.append(nil)
        } else if let number = Double(raw.replacingOccurrences(of: "$", with: "")), number >= 0, number.isFinite {
          prices.append(number)
        } else {
          return .failure(DraftError(message: "\(row.model): the \(field) price isn't a number."))
        }
      }
      out.append(.init(
        model: row.model, inputPerMtok: prices[0], outputPerMtok: prices[1], cacheReadPerMtok: prices[2],
        cacheWritePerMtok: prices[3]))
    }
    return .success(out)
  }

  public struct DraftError: Error, Equatable, Sendable {
    public let message: String
  }

  /// "3", "0.3", "15.75": what a price field shows for a stored rate.
  public static func text(_ value: Double?) -> String {
    guard let value else { return "" }
    var text = String(format: "%.4f", value)
    while text.hasSuffix("0") { text.removeLast() }
    if text.hasSuffix(".") { text.removeLast() }
    return text
  }
}

extension String {
  fileprivate var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}
