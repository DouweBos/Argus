import ArgusKit
import Foundation

/// Model prices set by hand, over `usage.prices` / `usage.set_prices` on both
/// the gateway and the socket. A save changes every cost, so it reloads the summary.
extension HostStore {
  public func loadUsagePrices() async {
    guard let backend else { return }
    do {
      usagePrices = try await backend.request(
        .usagePrices, ArgusProtocol.MethodsTypes.UsagePricesParams(), as: ArgusProtocol.UsagePrices.self)
      usagePricesError = nil
    } catch {
      guard !Self.isQuiet(error) else { return }
      usagePricesError = Self.describe(error)
      hooks.errorReported(error, "usage_prices")
    }
  }

  /// Nil once saved; else the host's reason, for the editor to show inline.
  public func saveUsagePrices(_ overrides: [ArgusProtocol.UsagePriceOverride]) async -> String? {
    guard let backend else { return "Not connected to the computer." }
    do {
      usagePrices = try await backend.request(
        .usageSetPrices, ArgusProtocol.MethodsTypes.UsageSetPricesParams(overrides: overrides),
        as: ArgusProtocol.UsagePrices.self)
    } catch {
      return Self.describe(error)
    }
    if let range = usageSummary?.range { await loadUsageSummary(range: range) }
    return nil
  }
}
