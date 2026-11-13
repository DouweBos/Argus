import ArgusKit
import Foundation

/// Which models Usage counts, over `usage.model_filter` / `usage.set_model_filter`.
/// A save changes every total, so it reloads the summary.
extension HostStore {
  public func loadUsageModelFilter() async {
    guard let backend else { return }
    do {
      let result = try await backend.request(
        .usageModelFilter, ArgusProtocol.MethodsTypes.UsageModelFilterParams(),
        as: ArgusProtocol.MethodsTypes.UsageModelFilterResult.self)
      usageModelFilter = result.filter ?? .empty
      usageModelFilterError = nil
    } catch {
      guard !Self.isQuiet(error) else { return }
      usageModelFilterError = Self.describe(error)
      hooks.errorReported(error, "usage_model_filter")
    }
  }

  /// Shown at once and put back if the host refuses. Nil once saved; else the
  /// host's reason, for the editor to show inline.
  public func saveUsageModelFilter(_ filter: ArgusProtocol.UsageModelFilter) async -> String? {
    guard let backend else { return "Not connected to the computer." }
    let previous = usageModelFilter
    usageModelFilter = filter
    do {
      let result = try await backend.request(
        .usageSetModelFilter, ArgusProtocol.MethodsTypes.UsageSetModelFilterParams(filter: filter.orNil),
        as: ArgusProtocol.MethodsTypes.UsageSetModelFilterResult.self)
      usageModelFilter = result.filter ?? .empty
    } catch {
      usageModelFilter = previous
      return Self.describe(error)
    }
    if let range = usageSummary?.range { await loadUsageSummary(range: range) }
    return nil
  }
}
