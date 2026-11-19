import AVFoundation
import AppKit
import ArgusUI
import SwiftUI

/// A capture card's or camera's live picture, view-only. Only ever shown for
/// sessions on this Mac; the video never leaves this process.
struct VideoInputView: View {
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  /// The picked input; nil when none is picked or it was unplugged.
  let input: VideoInputs.Input?
  /// Whether the panel shows a session on this Mac.
  let local: Bool
  @State private var access = AVCaptureDevice.authorizationStatus(for: .video)
  @State private var failure: String?

  private static let privacySettings = URL(
    string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera")!

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(theme.bg)
      .task(id: input?.id) { await start() }
  }

  @ViewBuilder
  private var content: some View {
    if !local {
      EmptyState(
        icon: "video.slash", title: "Only on this Mac",
        body: "Capture cards and cameras can only be watched for sessions on this Mac.")
      { EmptyView() }
    } else if let input {
      switch access {
      case .authorized:
        if let failure {
          EmptyState(icon: "exclamationmark.triangle", title: "Can't show \(input.name)", body: failure) {
            Button("Try Again") {
              self.failure = nil
            }
          }
        } else {
          CapturePreview(deviceId: input.id) { error in
            failure = error
            MacTelemetry.capture(.videoInputShown(outcome: .failed))
          }
          .background(Color.black)
        }
      case .notDetermined:
        ProgressView()
      default:
        EmptyState(
          icon: "video.slash", title: "Camera access is off",
          body: "Allow Argus to use the camera in System Settings to see capture cards and cameras.")
        {
          Button("Open Privacy Settings") { openURL(Self.privacySettings) }
        }
      }
    } else {
      EmptyState(
        icon: "video", title: "Pick a video input",
        body: "Capture cards and cameras connected to this Mac show up under Video Inputs.")
      { EmptyView() }
    }
  }

  private func start() async {
    guard local, input != nil else { return }
    failure = nil
    if access == .notDetermined {
      _ = await AVCaptureDevice.requestAccess(for: .video)
      access = AVCaptureDevice.authorizationStatus(for: .video)
    }
    MacTelemetry.capture(.videoInputShown(outcome: access == .authorized ? .started : .denied))
  }
}

/// An `AVCaptureVideoPreviewLayer` over one device, letterboxed to fit.
private struct CapturePreview: NSViewRepresentable {
  let deviceId: String
  let onFailure: (String) -> Void

  func makeNSView(context: Context) -> PreviewView {
    let view = PreviewView()
    view.show(deviceId, onFailure: onFailure)
    return view
  }

  func updateNSView(_ view: PreviewView, context: Context) {
    view.show(deviceId, onFailure: onFailure)
  }

  static func dismantleNSView(_ view: PreviewView, coordinator: ()) {
    view.stop()
  }

  final class PreviewView: NSView {
    private nonisolated(unsafe) let session = AVCaptureSession()
    private let preview: AVCaptureVideoPreviewLayer
    /// `startRunning` blocks, so the session runs off the main thread.
    private let queue = DispatchQueue(label: "argus.video-input")
    private var deviceId: String?

    override init(frame: NSRect) {
      preview = AVCaptureVideoPreviewLayer(session: session)
      super.init(frame: frame)
      preview.videoGravity = .resizeAspect
      wantsLayer = true
      layer = preview
    }

    required init?(coder: NSCoder) { nil }

    func show(_ id: String, onFailure: @escaping (String) -> Void) {
      guard id != deviceId else { return }
      deviceId = id
      guard let device = AVCaptureDevice(uniqueID: id) else {
        fail("It isn't connected anymore.", onFailure)
        return
      }
      let input: AVCaptureDeviceInput
      do {
        input = try AVCaptureDeviceInput(device: device)
      } catch {
        fail(error.localizedDescription, onFailure)
        return
      }
      nonisolated(unsafe) let newInput = input
      let session = session
      queue.async {
        session.beginConfiguration()
        session.inputs.forEach(session.removeInput)
        if session.canAddInput(newInput) { session.addInput(newInput) }
        session.commitConfiguration()
        if !session.isRunning { session.startRunning() }
      }
    }

    /// Reported after this update, which SwiftUI doesn't allow state changes in.
    private func fail(_ message: String, _ onFailure: @escaping (String) -> Void) {
      Task { @MainActor in onFailure(message) }
    }

    func stop() {
      let session = session
      queue.async { session.stopRunning() }
    }
  }
}
