import ArgusUI
import SwiftUI

/// A simulator that can't boot as it is, with the ways out simctl offers:
/// erase it to a fresh device, or delete it. Both ask first.
struct SimulatorProblemView: View {
  @Environment(\.theme) private var theme
  @Environment(RuntimeModel.self) private var runtime
  let udid: String
  let name: String
  let problem: ArgusProtocol.SimulatorProblem
  /// Called once the device was erased or deleted.
  var onRepaired: () -> Void = {}

  @State private var confirming: RuntimeModel.Repair?
  @State private var working = false
  @State private var failure: String?

  var body: some View {
    VStack(spacing: 10) {
      Label(problem.message, systemImage: Icon.warning)
        .font(.scaled(size: 12, weight: .medium))
        .foregroundStyle(theme.warning)
        .multilineTextAlignment(.center)
      HStack(spacing: 8) {
        if problem.kind == .missingData {
          Button("Erase…") { confirming = .erase }
        }
        Button("Delete…", role: .destructive) { confirming = .delete }
      }
      .disabled(working)
      if let failure {
        Text(failure).font(.scaled(size: 11)).foregroundStyle(theme.error)
          .multilineTextAlignment(.center)
      }
    }
    .confirmationDialog(
      confirming == .erase ? "Erase “\(name)”?" : "Delete “\(name)”?",
      isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } })
    ) {
      if let action = confirming {
        Button(action == .erase ? "Erase" : "Delete", role: .destructive) { run(action) }
      }
    } message: {
      Text(
        confirming == .erase
          ? "It starts over as a fresh device: installed apps and their data are removed."
          : "The simulator and everything on it are removed from this Mac.")
    }
  }

  private func run(_ action: RuntimeModel.Repair) {
    working = true
    failure = nil
    Task {
      do {
        try await runtime.repairSimulator(udid, action)
        onRepaired()
      } catch {
        failure = HostStore.describe(error)
      }
      working = false
    }
  }
}
