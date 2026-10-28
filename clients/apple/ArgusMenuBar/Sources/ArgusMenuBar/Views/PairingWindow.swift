import ArgusCore
import ArgusUI
import SwiftUI

/// Pair a Device: the shared pairing panel (QR, code, the device's 6-digit
/// code and the grants), closing itself once the pairing is closed.
public struct PairingWindow: View {
  let pairing: PairingModel
  @Environment(\.dismissWindow) private var dismissWindow

  public init(pairing: PairingModel) {
    self.pairing = pairing
  }

  public var body: some View {
    PairingPanel(model: pairing, subject: "this Mac")
      .onChange(of: pairing.presented) { _, presented in
        if !presented { dismissWindow(id: HostMenuWindow.pairing.rawValue) }
      }
      .onDisappear {
        // Closing the window keeps a pairing in progress: the menu still shows it.
        if !pairing.isActive { pairing.close() }
      }
  }
}
