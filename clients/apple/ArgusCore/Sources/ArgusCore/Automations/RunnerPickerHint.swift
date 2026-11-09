import ArgusKit

/// The second line a runner picker shows: why it can't be picked, else that it's the user's own.
public enum RunnerPickerHint {
  public static func hint(available: Bool, reason: String?, isCustom: Bool) -> String? {
    guard available else { return reason ?? "Not installed on this computer" }
    return isCustom ? "Custom" : nil
  }
}

extension RemoteRunner {
  public var pickerHint: String? {
    RunnerPickerHint.hint(available: isAvailable, reason: unavailableReason, isCustom: isCustom)
  }
}

extension ArgusProtocol.RegisteredRunner {
  public var isAvailable: Bool { available ?? true }

  public var pickerHint: String? {
    RunnerPickerHint.hint(available: isAvailable, reason: unavailableReason, isCustom: isCustom)
  }
}
