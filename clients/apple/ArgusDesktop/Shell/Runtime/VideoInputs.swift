import AVFoundation
import Foundation
import Observation

/// Capture cards and cameras connected to this Mac. Listed and shown in this
/// process only: no host command or gateway method reaches them, so a remote
/// computer or a paired phone can never see or open one.
@MainActor
@Observable
final class VideoInputs {
  struct Input: Identifiable, Equatable {
    /// `AVCaptureDevice.uniqueID`: stable across launches and replugs.
    let id: String
    let name: String
  }

  private(set) var inputs: [Input] = []
  @ObservationIgnored private var observers: [NSObjectProtocol] = []

  init() {
    refresh()
    let center = NotificationCenter.default
    for name in [AVCaptureDevice.wasConnectedNotification, AVCaptureDevice.wasDisconnectedNotification] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.refresh() }
        })
    }
  }

  /// Listing needs no camera access; only showing a picture does.
  func refresh() {
    let discovery = AVCaptureDevice.DiscoverySession(
      deviceTypes: [.external, .builtInWideAngleCamera, .continuityCamera],
      mediaType: .video, position: .unspecified)
    let next = discovery.devices.map { Input(id: $0.uniqueID, name: $0.localizedName) }
    if next != inputs { inputs = next }
  }

  func input(_ id: String?) -> Input? {
    id.flatMap { id in inputs.first { $0.id == id } }
  }
}
