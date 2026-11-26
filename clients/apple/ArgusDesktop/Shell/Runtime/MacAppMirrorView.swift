import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// The Device tab on an app of this Mac: the permissions it needs, a picker of
/// windows, then the picked one live with clicks, scrolling and typing sent to it.
/// Only ever shown for sessions on this Mac; the picture never leaves this process.
struct MacAppMirrorView: View {
  @Environment(\.theme) private var theme
  let apps: MacApps
  /// The picked window's `MacAppTarget.key`; nil when none is picked.
  let selection: String?
  /// Whether the panel shows a session on this Mac.
  let local: Bool
  let pick: (MacAppWindow) -> Void

  var body: some View {
    content
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(theme.bg)
      .task(id: local) {
        guard local else { return }
        apps.refresh()
      }
      .task(id: selection) {
        // Picked while macOS still blocks capture: the mirror can't start.
        guard local, selection != nil, apps.permissions.blocking != nil else { return }
        MacTelemetry.capture(.macAppMirrorStarted(success: false, missingPermission: .screenRecording))
      }
  }

  @ViewBuilder
  private var content: some View {
    if !local {
      EmptyState(
        icon: "macwindow.badge.plus", title: "Only on this Mac",
        body: "Apps can only be mirrored for sessions on this Mac.")
    } else if apps.permissions.blocking != nil {
      MacAppPermissionsView(apps: apps)
    } else if let window = apps.window(selection) {
      MacAppMirrorStage(apps: apps, window: window)
        .id(window.windowId)
    } else {
      MacAppPicker(apps: apps, selection: selection, pick: pick)
    }
  }
}

/// The live window, and the input sent back to it once Accessibility allows.
private struct MacAppMirrorStage: View {
  @Environment(\.theme) private var theme
  let apps: MacApps
  let window: MacAppWindow
  @State private var status = Status.connecting
  @State private var frame: CGRect?
  @State private var stage = CGSize.zero
  @State private var clickCount = 1
  @State private var reported = false

  enum Status: Equatable {
    case connecting, streaming, closed
    case failed(String)
  }

  private var canControl: Bool { !apps.permissions.viewOnly }

  var body: some View {
    ZStack {
      MacAppMirrorSurface(windowId: window.windowId, onEvent: receive)
      if canControl, status == .streaming {
        RuntimeInputView(onInput: send)
      }
      if let message {
        Text(message)
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
          .multilineTextAlignment(.center)
          .padding(theme.space)
          .allowsHitTesting(false)
      }
    }
    .onGeometryChange(for: CGSize.self) { $0.size } action: { stage = $0 }
    .overlay(alignment: .bottom) {
      if apps.permissions.viewOnly, status == .streaming {
        MacAppViewOnlyBanner(appName: window.appName) { apps.request(.accessibility) }
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel("\(window.appName) window")
  }

  private var message: String? {
    switch status {
    case .connecting: "Connecting to \(window.appName)"
    case .streaming: nil
    case .closed: "\(window.appName) closed this window. Pick another one from the device menu."
    case .failed(let error): "Can't show \(window.appName): \(error)"
    }
  }

  private func receive(_ event: MacAppMirrorSurface.Event) {
    switch event {
    case .firstFrame:
      status = .streaming
      report(success: true)
    case .moved(let now):
      frame = now
    case .failed(let error):
      status = .failed(error)
      report(success: false)
    case .closed:
      status = .closed
      apps.refresh()
    }
  }

  private func report(success: Bool) {
    guard !reported else { return }
    reported = true
    MacTelemetry.capture(.macAppMirrorStarted(success: success, missingPermission: apps.permissions.missing))
  }

  private func send(_ input: RuntimeInput) {
    guard let frame else { return }
    if case .pointer(.down, _, _, let count) = input { clickCount = count }
    _ = MacAppInput(window: window, frame: frame, stage: stage).post(input, clickCount: clickCount)
  }
}
