import SwiftUI
import UIKit

/// The share sheet's entry point: hands what was shared to SwiftUI and closes
/// the sheet when an agent has started or the share was cancelled.
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    let model = ShareModel(providers: providers) { [weak self] started in
      if started {
        self?.extensionContext?.completeRequest(returningItems: nil)
      } else {
        self?.extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
      }
    }
    let hosting = UIHostingController(rootView: ShareRootView(model: model))
    addChild(hosting)
    hosting.view.frame = view.bounds
    hosting.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(hosting.view)
    hosting.didMove(toParent: self)
  }
}
