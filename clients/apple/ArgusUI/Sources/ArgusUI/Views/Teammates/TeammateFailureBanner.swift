import ArgusKit
import SwiftUI

/// Over a teammate conversation's composer when its last turn stopped short:
/// why, and Resume to pick it back up.
public struct TeammateFailureBanner: View {
  let failure: ArgusProtocol.TeammateThreadFailure
  /// Nil hides Resume, e.g. on a device without control.
  let onResume: (() -> Void)?

  public init(failure: ArgusProtocol.TeammateThreadFailure, onResume: (() -> Void)?) {
    self.failure = failure
    self.onResume = onResume
  }

  public var body: some View {
    Banner(
      text: Labels.threadFailureDetail(failure),
      tone: failure.kind == .limit ? .warning : .danger,
      title: Labels.threadFailureTitle(failure.kind),
      actionLabel: onResume == nil ? nil : "Resume",
      actionTone: .primary,
      action: onResume)
  }
}
