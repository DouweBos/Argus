import ArgusUI
@preconcurrency import AVFoundation
import SwiftUI

/// Scan the desktop's QR (or paste its code), compare the six digits, done.
struct PairView: View {
  private enum Phase {
    case scan
    case awaitingConfirmation(sas: String)
  }

  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router

  @State private var phase = Phase.scan
  @State private var manualCode = ""
  @State private var error: String?
  @State private var client: PairingClient?
  @State private var pump: Task<Void, Never>?

  var body: some View {
    Screen {
      switch phase {
      case .scan:
        scanning
      case .awaitingConfirmation(let sas):
        confirming(sas: sas)
      }
    }
    .navigationTitle("Pair a computer")
    .navigationBarTitleDisplayMode(.inline)
    .onDisappear { cancel() }
  }

  @ViewBuilder
  private var scanning: some View {
    if !app.account.isSignedIn {
      Card {
        BodyText("Sign in to your Argus account")
        MutedText(
          "Computers on your account show up on their own — no code to scan for each one — and each gets its own tunnel, so you reach it from anywhere.")
        Btn(label: "Sign in") { router.push(.account) }
      }
      SectionHeader(title: "Or scan a QR code")
    }
    MutedText(
      "In Argus on your computer, open Settings → Remote → Start Pairing…. A scanned pairing works on the same Wi-Fi, or over Tailscale when both devices are on your tailnet.")

    QRScannerView { code in begin(code) }
      .aspectRatio(1, contentMode: .fit)
      .frame(maxWidth: 360)
      .background(theme.mediaBg)
      .clipShape(RoundedRectangle(cornerRadius: theme.radius))
      .frame(maxWidth: .infinity, alignment: .center)

    Card {
      MutedText("Or paste the pairing code")
      ThemedTextField(
        placeholder: "paste code", text: $manualCode, multiline: true, input: .code)
      Btn(label: "Pair", small: true) { begin(manualCode) }
        .disabled(manualCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    if let error {
      Banner(text: error, tone: .danger)
    }
  }

  @ViewBuilder
  private func confirming(sas: String) -> some View {
    TitleText("Confirm the code")
    MutedText(
      "Check this matches the code shown in Argus, then tap “Codes match — pair” on your computer.")
    Card {
      Text(sas)
        .font(.system(size: 30, weight: .semibold, design: .monospaced))
        .kerning(6)
        .frame(maxWidth: .infinity)
        .foregroundStyle(theme.text)
    }
    HStack(spacing: 8) {
      ProgressView().controlSize(.small)
      MutedText("Waiting for confirmation…")
    }
    Btn(label: "Cancel", tone: .ghost) {
      cancel()
      phase = .scan
    }
  }

  private func begin(_ raw: String) {
    guard client == nil else { return }
    error = nil
    do {
      let payload = try PairingClient.parse(raw)
      let client = PairingClient(
        payload: payload,
        client: PairingClientInfo(
          product: "Argus Remote", kind: "mobile", device: UIDeviceName.current))
      self.client = client
      pump = Task {
        for await event in await client.start() {
          switch event {
          case .sas(let sas):
            phase = .awaitingConfirmation(sas: sas)
          case .paired(let identity):
            await app.pairCompleted(identity)
            router.popToRoot()
          case .failed(let failure):
            Telemetry.capture(.pairFailed(reason: reason(for: failure)))
            self.error = message(for: failure)
            self.client = nil
            phase = .scan
          }
        }
      }
    } catch {
      Telemetry.capture(.pairFailed(reason: "invalidCode"))
      self.error = "That doesn't look like a valid pairing code."
    }
  }

  private func cancel() {
    pump?.cancel()
    pump = nil
    let current = client
    client = nil
    Task { await current?.cancel() }
  }

  /// The case name alone — the message behind it is written for a person and
  /// says more about the computer than a funnel needs.
  private func reason(for error: PairingError) -> String {
    switch error {
    case .invalidCode: "invalidCode"
    case .handshakeFailed: "handshakeFailed"
    case .unreadableGrant: "unreadableGrant"
    case .cancelled: "cancelled"
    }
  }

  private func message(for error: PairingError) -> String {
    switch error {
    case .invalidCode: "That doesn't look like a valid pairing code."
    case .handshakeFailed: "Pairing failed — wrong code, or a machine in the middle."
    case .unreadableGrant: "Couldn't read the pairing grant."
    case .cancelled: "Pairing cancelled."
    }
  }
}

/// A plain AVFoundation QR reader — the camera is only ever used for this and
/// for attaching a photo, so there is no need for a general capture stack.
struct QRScannerView: UIViewControllerRepresentable {
  let onCode: (String) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

  func makeUIViewController(context: Context) -> ScannerController {
    let controller = ScannerController()
    controller.delegate = context.coordinator
    return controller
  }

  func updateUIViewController(_ controller: ScannerController, context: Context) {}

  final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    private let onCode: (String) -> Void
    /// One code is enough; the handshake takes it from here.
    private var handled = false

    init(onCode: @escaping (String) -> Void) { self.onCode = onCode }

    func metadataOutput(
      _ output: AVCaptureMetadataOutput,
      didOutput metadataObjects: [AVMetadataObject],
      from connection: AVCaptureConnection
    ) {
      guard !handled,
        let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
        let value = object.stringValue
      else { return }
      handled = true
      onCode(value)
    }
  }

  final class ScannerController: UIViewController {
    weak var delegate: AVCaptureMetadataOutputObjectsDelegate?
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var rotationCoordinator: AVCaptureDevice.RotationCoordinator?
    private var rotationObservation: NSKeyValueObservation?
    /// `AVCaptureSession` start/stop blocks, and the type isn't `Sendable`,
    /// so it stays on one private queue rather than crossing actors.
    private let sessionQueue = DispatchQueue(label: "dev.houwert.argus.qr")

    override func viewDidLoad() {
      super.viewDidLoad()
      guard let device = AVCaptureDevice.default(for: .video),
        let input = try? AVCaptureDeviceInput(device: device),
        session.canAddInput(input)
      else { return }
      session.addInput(input)

      let output = AVCaptureMetadataOutput()
      guard session.canAddOutput(output) else { return }
      session.addOutput(output)
      output.setMetadataObjectsDelegate(delegate, queue: .main)
      output.metadataObjectTypes = [.qr]

      let preview = AVCaptureVideoPreviewLayer(session: session)
      preview.videoGravity = .resizeAspectFill
      view.layer.addSublayer(preview)
      self.preview = preview

      let coordinator = AVCaptureDevice.RotationCoordinator(
        device: device, previewLayer: preview)
      rotationCoordinator = coordinator
      applyRotation(coordinator.videoRotationAngleForHorizonLevelPreview)
      rotationObservation = coordinator.observe(
        \.videoRotationAngleForHorizonLevelPreview, options: [.new]
      ) { [weak self] _, change in
        guard let angle = change.newValue else { return }
        Task { @MainActor in self?.applyRotation(angle) }
      }
    }

    private func applyRotation(_ angle: CGFloat) {
      guard let connection = preview?.connection,
        connection.isVideoRotationAngleSupported(angle)
      else { return }
      connection.videoRotationAngle = angle
    }

    override func viewDidLayoutSubviews() {
      super.viewDidLayoutSubviews()
      preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
      super.viewWillAppear(animated)
      guard !session.isRunning else { return }
      sessionQueue.async { [session] in session.startRunning() }
    }

    override func viewWillDisappear(_ animated: Bool) {
      super.viewWillDisappear(animated)
      guard session.isRunning else { return }
      sessionQueue.async { [session] in session.stopRunning() }
    }
  }
}
