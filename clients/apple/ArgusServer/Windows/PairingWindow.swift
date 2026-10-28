import ArgusUI
import SwiftUI

/// Pair a Device: the shared pairing panel (QR, code, the device's 6-digit
/// code and the grants), closing itself once the pairing is closed.
struct PairingWindow: View {
  let model: ServerModel
  @Environment(\.dismissWindow) private var dismissWindow

  var body: some View {
    PairingPanel(model: model.pairing, subject: "this Mac")
      .onChange(of: model.pairing.presented) { _, presented in
        if !presented { dismissWindow(id: ServerModel.Window.pairing.rawValue) }
      }
      .onDisappear {
        // Closing the window keeps a pairing in progress: the menu still shows it.
        if !model.pairing.isActive { model.pairing.close() }
      }
  }
}
