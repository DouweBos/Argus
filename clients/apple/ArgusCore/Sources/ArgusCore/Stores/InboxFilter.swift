import Foundation

/// Which automation's and which project's items the inbox shows; empty shows
/// everything. Part of the `/inbox` route, as `?automation=&project=`.
public struct InboxFilter: Hashable, Sendable {
  public var automationId: String?
  /// A project's folder name, as the gateway names projects.
  public var project: String?

  public init(automationId: String? = nil, project: String? = nil) {
    self.automationId = automationId
    self.project = project
  }

  public static let all = InboxFilter()

  public var isEmpty: Bool { automationId == nil && project == nil }

  public func matches(_ proposal: some InboxProposal) -> Bool {
    (automationId == nil || proposal.automationId == automationId)
      && (project == nil || proposal.projectName == project)
  }

  public func matches(_ run: some InboxRun) -> Bool {
    project == nil && (automationId == nil || run.automationId == automationId)
  }
}

/// One entry of an inbox filter menu.
public struct InboxFilterOption: Hashable, Sendable, Identifiable {
  public var value: String
  public var label: String
  public var count: Int
  public var id: String { value }
}

public struct InboxFilterOptions: Hashable, Sendable {
  public var automations: [InboxFilterOption]
  public var projects: [InboxFilterOption]

  /// "Weekly analysis · Argus": what a filter narrows the inbox to.
  public func summary(_ filter: InboxFilter) -> String {
    [
      filter.automationId.map { id in automations.first { $0.value == id }?.label ?? "One automation" },
      filter.project,
    ].compactMap { $0 }.joined(separator: " · ")
  }
}

/// Which inbox filter a user changed, for telemetry.
public enum InboxFilterField: String, Sendable {
  case automation, project
  /// Every filter removed at once.
  case clear
}
