import ArgusCore
import SwiftUI

/// A boot waiting on the user to accept an EAS Simulator session's cost.
struct PendingEasStart: Identifiable {
  let id: String
  let message: String
  let start: () -> Void
}

extension View {
  /// Asks before a boot that would start a billed EAS Simulator session.
  func easStartConfirmation(_ pending: Binding<PendingEasStart?>) -> some View {
    confirmationDialog(
      EasBilling.startTitle,
      isPresented: Binding(get: { pending.wrappedValue != nil }, set: { if !$0 { pending.wrappedValue = nil } }),
      titleVisibility: .visible,
      presenting: pending.wrappedValue
    ) { request in
      Button(EasBilling.startConfirm) {
        MacTelemetry.capture(.easSessionStartPrompted(outcome: .confirmed))
        request.start()
      }
      Button("Cancel", role: .cancel) {
        MacTelemetry.capture(.easSessionStartPrompted(outcome: .cancelled))
      }
    } message: { request in
      Text(request.message)
    }
  }
}

extension RuntimeModel {
  /// The cost prompt for booting `deviceId`, or nil when the boot isn't billed.
  func easStartPrompt(_ deviceId: String, running: Bool, start: @escaping () -> Void) async
    -> PendingEasStart?
  {
    guard EasBilling.isBillableStart(deviceId: deviceId, running: running) else { return nil }
    let hostId = EasBilling.hostId(of: deviceId)
    let host = try? await easHosts().first { $0.id == hostId }
    return PendingEasStart(
      id: deviceId,
      message: EasBilling.startMessage(
        idleMinutes: host.map { Int($0.idleMinutes) },
        maxSessionMinutes: host.map { Int($0.maxSessionMinutes) }),
      start: start)
  }
}
