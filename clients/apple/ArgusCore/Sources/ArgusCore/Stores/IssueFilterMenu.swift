import ArgusKit
import Foundation
import Observation

/// An open "Add filter…" menu: the fields, the values of the one opened beside
/// them, what's typed in each and what the keyboard is on. Changes go straight
/// to the filters through `apply`.
@MainActor
@Observable
public final class IssueFilterMenu {
  public typealias Field = IssueFilter.Field

  public let issues: [ArgusProtocol.LinearIssue]
  public let states: [ArgusProtocol.LinearWorkflowState]
  /// Opened from a filter chip: just that field's values, no field list.
  public let pinned: Field?
  /// The field whose values show; nil while only the fields do.
  public private(set) var field: Field?
  public var fieldQuery = "" {
    didSet {
      guard fieldQuery != oldValue else { return }
      highlightedField = nil
      // Searching the fields again means the open values are no longer the point.
      if pinned == nil { field = nil }
    }
  }
  public var valueQuery = "" {
    didSet { if valueQuery != oldValue { highlightedValue = nil } }
  }
  public var highlightedField: Field?
  public var highlightedValue: String?
  /// The footer was clicked: options no issue matches show too.
  public var showsUnmatched = false

  private let read: () -> [IssueFilter]
  private let apply: ([IssueFilter]) -> Void

  public init(
    issues: [ArgusProtocol.LinearIssue], states: [ArgusProtocol.LinearWorkflowState] = [], field: Field? = nil,
    filters: @escaping () -> [IssueFilter], apply: @escaping ([IssueFilter]) -> Void
  ) {
    self.issues = issues
    self.states = states
    self.pinned = field
    self.field = field
    self.read = filters
    self.apply = apply
    if let field, field.isText {
      valueQuery = filters().first { $0.field == field }?.values.joined(separator: " ") ?? ""
    }
  }

  private func matches(_ text: String, _ query: String) -> Bool {
    let query = query.trimmingCharacters(in: .whitespaces)
    return query.isEmpty || text.localizedCaseInsensitiveContains(query)
  }

  /// The fields matching what's typed, in the menu's groups.
  public var fieldGroups: [[Field]] {
    IssueFilters.groups.map { $0.filter { matches($0.label, fieldQuery) } }.filter { !$0.isEmpty }
  }

  public var picked: [String] {
    guard let field else { return [] }
    return read().first { $0.field == field }?.values ?? []
  }

  /// The open field's options matching what's typed, split into the ones some
  /// issue (or the filter) has and the ones none does.
  public var options: (shown: [IssueFilter.Option], unmatched: [IssueFilter.Option]) {
    guard let field, !field.isText else { return ([], []) }
    let picked = Set(picked)
    let all = IssueFilters.options(field, issues: issues, states: states).filter { matches($0.label, valueQuery) }
    let unmatched = all.filter { $0.count == 0 && !picked.contains($0.value) }
    let shown = all.filter { $0.count > 0 || picked.contains($0.value) }
    return showsUnmatched ? (shown + unmatched, []) : (shown, unmatched)
  }

  /// The keyboard works in the values once they're open, else in the fields.
  public var inValues: Bool { field != nil }

  public func open(_ next: Field?) {
    field = next ?? pinned
    valueQuery = ""
    highlightedValue = nil
    showsUnmatched = false
  }

  public func move(_ step: Int) {
    if inValues {
      let rows = options.shown.map(\.value)
      highlightedValue = Self.step(rows, from: highlightedValue, by: step)
    } else {
      highlightedField = Self.step(fieldGroups.flatMap { $0 }, from: highlightedField, by: step)
    }
  }

  private static func step<T: Equatable>(_ rows: [T], from current: T?, by step: Int) -> T? {
    guard !rows.isEmpty else { return nil }
    guard let current, let at = rows.firstIndex(of: current) else { return step > 0 ? rows.first : rows.last }
    return rows[(at + step + rows.count) % rows.count]
  }

  public func toggle(_ value: String) {
    guard let field else { return }
    apply(IssueFilters.toggling(read(), field, value))
  }

  /// Return. True when the menu is done and should close.
  public func submit() -> Bool {
    guard let field else {
      let first = fieldGroups.flatMap { $0 }.first
      if let target = highlightedField ?? first { open(target) }
      return false
    }
    if field.isText {
      let text = valueQuery.trimmingCharacters(in: .whitespaces)
      apply(
        IssueFilters.updating(read(), field) { filter in
          var filter = filter
          filter.values = text.isEmpty ? [] : [text]
          return filter
        })
      return true
    }
    let rows = options.shown
    guard let option = rows.first(where: { $0.value == highlightedValue }) ?? rows.first else { return false }
    toggle(option.value)
    return true
  }

  /// Esc: back to the fields when the values were opened from them. True when handled.
  public func back() -> Bool {
    guard field != nil, pinned == nil else { return false }
    highlightedField = field
    field = nil
    return true
  }
}
