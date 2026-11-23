import GroveUIKit

extension GitDialogPresenter {
  /// Reports how each dialog closed; what it ran reports itself through the host.
  static func argus() -> GitDialogPresenter {
    let presenter = GitDialogPresenter()
    presenter.onClose = { dialog, submitted in
      MacTelemetry.capture(.gitDialogClosed(dialog: dialog.kind, submitted: submitted))
    }
    return presenter
  }
}
