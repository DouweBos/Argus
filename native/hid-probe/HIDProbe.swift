// HIDProbe — a tiny SwiftUI app that logs the hardware inputs an iOS app can
// observe, so we can identify which IndigoHIDMessageForButton / keyboard
// keycodes the argus-sim-bridge sends map to which physical button:
//
//   • Volume Up/Down  — via AVAudioSession.outputVolume KVO (direction from delta)
//   • Hardware keys    — via UIResponder.pressesBegan (UIKey.keyCode + characters)
//   • Media remote     — via MPRemoteCommandCenter (play/pause/next/prev)
//
// Home/Lock/Action can't be seen by an app (they background it / are opaque),
// but volume + keyboard are exactly the gaps we needed to nail down.

import SwiftUI
import UIKit
import AVFoundation
import MediaPlayer

// ---------------------------------------------------------------------------
// Shared log
// ---------------------------------------------------------------------------

final class EventLog: ObservableObject {
    @Published var lines: [String] = ["HIDProbe ready — waiting for input…"]

    func add(_ s: String) {
        DispatchQueue.main.async {
            let t = Date().formatted(.dateTime.hour().minute().second())
            self.lines.insert("\(t)  \(s)", at: 0)
            if self.lines.count > 300 { self.lines.removeLast() }
        }
    }
}

// ---------------------------------------------------------------------------
// Volume watcher — outputVolume changes when a volume button is pressed
// ---------------------------------------------------------------------------

final class VolumeWatcher: NSObject, ObservableObject {
    private let log: EventLog
    private var last: Float = 0.5
    @Published var volume: Float = 0.5

    init(log: EventLog) {
        self.log = log
        super.init()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, options: [.mixWithOthers])
        try? session.setActive(true)
        last = session.outputVolume
        volume = last
        session.addObserver(self, forKeyPath: "outputVolume",
                            options: [.new, .initial], context: nil)
    }

    override func observeValue(forKeyPath keyPath: String?, of object: Any?,
                              change: [NSKeyValueChangeKey: Any]?,
                              context: UnsafeMutableRawPointer?) {
        guard keyPath == "outputVolume",
              let v = change?[.newKey] as? Float else { return }
        let delta = v - last
        if abs(delta) > 0.0001 {
            let dir = delta > 0 ? "⬆︎ VOLUME UP" : "⬇︎ VOLUME DOWN"
            log.add("\(dir)  (\(String(format: "%.3f", last)) → \(String(format: "%.3f", v)))")
        }
        last = v
        DispatchQueue.main.async { self.volume = v }
    }
}

// ---------------------------------------------------------------------------
// Key capture — a first-responder VC that logs hardware key presses
// ---------------------------------------------------------------------------

final class KeyCaptureVC: UIViewController {
    var log: EventLog?

    override var canBecomeFirstResponder: Bool { true }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
    }

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var handled = false
        for press in presses {
            if let key = press.key {
                log?.add("⌨️ keyDown  keyCode=\(key.keyCode.rawValue) chars=\"\(key.characters)\" mod=\(key.modifierFlags.rawValue)")
                handled = true
            }
        }
        if !handled { super.pressesBegan(presses, with: event) }
    }
}

struct KeyCapture: UIViewControllerRepresentable {
    let log: EventLog
    func makeUIViewController(context: Context) -> KeyCaptureVC {
        let vc = KeyCaptureVC(); vc.log = log; return vc
    }
    func updateUIViewController(_ vc: KeyCaptureVC, context: Context) { vc.log = log }
}

// ---------------------------------------------------------------------------
// Media remote — some hardware buttons surface as remote commands
// ---------------------------------------------------------------------------

func installRemoteCommands(_ log: EventLog) {
    let c = MPRemoteCommandCenter.shared()
    let map: [(MPRemoteCommand, String)] = [
        (c.playCommand, "▶︎ play"), (c.pauseCommand, "⏸ pause"),
        (c.togglePlayPauseCommand, "⏯ togglePlayPause"),
        (c.nextTrackCommand, "⏭ next"), (c.previousTrackCommand, "⏮ prev"),
    ]
    for (cmd, name) in map {
        cmd.isEnabled = true
        cmd.addTarget { _ in log.add("🎛 remote \(name)"); return .success }
    }
    // A now-playing entry makes the remote commands active.
    MPNowPlayingInfoCenter.default().nowPlayingInfo = [MPMediaItemPropertyTitle: "HIDProbe"]
    try? AVAudioSession.sharedInstance().setActive(true)
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

struct ContentView: View {
    @StateObject private var log = EventLog()
    @StateObject private var volume: VolumeWatcher
    @State private var started = false

    init() {
        let l = EventLog()
        _log = StateObject(wrappedValue: l)
        _volume = StateObject(wrappedValue: VolumeWatcher(log: l))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("HIDProbe").font(.headline)
                Spacer()
                Text("vol \(String(format: "%.2f", volume.volume))")
                    .font(.system(.subheadline, design: .monospaced))
                Button("Clear") { log.lines = [] }
            }
            .padding()
            .background(Color(.secondarySystemBackground))

            KeyCapture(log: log).frame(height: 0)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(log.lines.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(.footnote, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
            }
        }
        .onAppear {
            if !started { started = true; installRemoteCommands(log) }
        }
    }
}

@main
struct HIDProbeApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
