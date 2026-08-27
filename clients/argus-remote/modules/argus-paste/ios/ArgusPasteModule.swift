import ExpoModulesCore

/// Forwards an image pasted through iOS's native edit menu to JS, which turns
/// it into a chat attachment.
public class ArgusPasteModule: Module {
  private var observer: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ArgusPaste")

    Events("onPasteImage")

    OnStartObserving {
      self.observer = NotificationCenter.default.addObserver(
        forName: .ArgusPasteImage,
        object: nil,
        queue: .main
      ) { [weak self] notification in
        guard let data = notification.userInfo?["data"] as? String else { return }
        self?.sendEvent("onPasteImage", ["data": data, "mediaType": "image/png"])
      }
    }

    OnStopObserving {
      if let observer = self.observer {
        NotificationCenter.default.removeObserver(observer)
        self.observer = nil
      }
    }
  }
}
