import ArgusCore
import SwiftUI

/// How Usage opens a model's detail and the price editor: the Mac navigates
/// its route, the phone pushes onto its stack. Unset, rows don't open anything.
public struct UsageNavigation {
  /// A model under Cost or Tokens, over the range on screen.
  public var openModel: @MainActor (UsageModelKey, UsageTab, ArgusProtocol.UsageRange) -> Void
  /// Opens the price editor, adding this model when one is given.
  public var openPrices: @MainActor (String?) -> Void

  public init(
    openModel: @escaping @MainActor (UsageModelKey, UsageTab, ArgusProtocol.UsageRange) -> Void, openPrices: @escaping @MainActor (String?) -> Void
  ) {
    self.openModel = openModel
    self.openPrices = openPrices
  }
}

extension EnvironmentValues {
  @Entry public var usageNavigation: UsageNavigation? = nil
}
