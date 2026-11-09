import ArgusUI
import SwiftUI

extension DesktopModel {
  /// Hands an element picked in the runtime panel to the session's composer.
  func attachToChat(_ element: PickedElement, sessionId: String) {
    pickedElements[sessionId, default: []].append(element)
    composerFocusRequest += 1
    MacTelemetry.capture(.elementPicked(source: element.source, success: true))
  }

  func takePickedElements(sessionId: String) -> [PickedElement] {
    pickedElements.removeValue(forKey: sessionId) ?? []
  }
}

/// Drains the session's picked elements into the composer under it, on
/// appear too: a pick made while another view showed waits for it.
private struct ReceivesPickedElements: ViewModifier {
  @Environment(DesktopModel.self) private var model
  let sessionId: String
  let drops: ComposerDropInbox

  func body(content: Content) -> some View {
    content
      .onAppear(perform: drain)
      .onChange(of: model.pickedElements[sessionId]?.count) { _, _ in drain() }
  }

  private func drain() {
    model.takePickedElements(sessionId: sessionId).forEach(drops.attach)
  }
}

extension View {
  func receivesPickedElements(sessionId: String, into drops: ComposerDropInbox) -> some View {
    modifier(ReceivesPickedElements(sessionId: sessionId, drops: drops))
  }
}
