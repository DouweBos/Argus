import AppKit
import ArgusUI
import SwiftUI

/// The picked device's app and system logs, streamed from `conductor logs` —
/// the renderer's Debug tool, as a mode of the runtime panel.
struct RuntimeLogsView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var store
  let deviceKey: String

  @State private var log = DebugLog()
  @State private var streamId = UUID().uuidString
  @State private var running = false
  @State private var error: String?
  @State private var filter = ""
  @State private var errorsOnly = false
  /// While paused the view holds still; lines keep arriving underneath.
  @State private var paused: [DebugLogEntry]?
  @State private var stopEvents: (() -> Void)?
  /// Chunks land here and reach `log` in batches: a simulator logs hundreds of
  /// lines a second, and redrawing per chunk pinned the main thread.
  @State private var inbox = LogInbox()

  private var visible: [DebugLogEntry] {
    (paused ?? log.entries).filter { (!errorsOnly || $0.isError) && $0.matches(filter) }
  }

  var body: some View {
    VStack(spacing: 0) {
      controls
      Divider()
      if let error {
        Text(error).font(.scaled(size: 11)).foregroundStyle(theme.error).padding(8)
      }
      lines
    }
    .task(id: "\(deviceKey)|\(store.connection == .ready)") {
      guard store.connection == .ready else { return }
      await start()
    }
    .task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(150))
        flush()
      }
    }
    .onDisappear { stop() }
  }

  private var controls: some View {
    HStack(spacing: 6) {
      Button(running ? "Stop" : "Start") {
        if running { stop() } else { Task { await start() } }
      }
      .controlSize(.small)
      Toggle("Pause", isOn: Binding(get: { paused != nil }, set: { paused = $0 ? log.entries : nil }))
        .toggleStyle(.button)
        .controlSize(.small)
      Toggle("Errors", isOn: $errorsOnly)
        .toggleStyle(.button)
        .controlSize(.small)
      TextField("Filter", text: $filter)
        .textFieldStyle(.roundedBorder)
        .controlSize(.small)
      Button {
        let text = visible.map(\.raw).joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      } label: {
        Image(systemName: "doc.on.doc")
      }
      .buttonStyle(.borderless)
      .help("Copy visible lines")
      Button {
        log.clear()
        paused = paused.map { _ in [] }
      } label: {
        Image(systemName: Icon.trash)
      }
      .buttonStyle(.borderless)
      .help("Clear")
    }
    .padding(.horizontal, 8)
    .frame(height: 32)
  }

  private var lines: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 1) {
          ForEach(visible) { entry in
            LogLine(entry: entry).id(entry.id)
          }
        }
        .padding(8)
        .textSelection(.enabled)
      }
      .overlay {
        if visible.isEmpty {
          Text(log.entries.isEmpty ? (running ? "Waiting for logs…" : "Not streaming.") : "No lines match the filter.")
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textMuted)
        }
      }
      .onChange(of: log.entries.last?.id) { _, last in
        if paused == nil, let last { proxy.scrollTo(last, anchor: .bottom) }
      }
    }
  }

  // MARK: Stream

  private func start() async {
    stop()
    error = nil
    let id = UUID().uuidString
    streamId = id
    stopEvents = store.observeIpc { channel, args, _ in
      if channel == "debug:data:\(id)", let payload = args.first?.objectValue,
        let text = payload["text"]?.stringValue
      {
        inbox.chunks.append((text, payload["source"]?.stringValue == "stderr" ? .stderr : .stdout))
      } else if channel == "debug:exit:\(id)" {
        running = false
        if let message = args.first?.objectValue?["error"]?.stringValue {
          error = "conductor failed to start: \(message)"
        }
      }
    }
    running = true
    do {
      _ = try await store.backend?.request(
        ArgusProtocol.Commands.DebugStartStream.self,
        .init(deviceKey: deviceKey, args: ["logs", "--json"], streamId: id))
    } catch {
      running = false
      self.error = HostStore.describe(error)
    }
  }

  private func flush() {
    guard !inbox.chunks.isEmpty else { return }
    var next = log
    for (text, source) in inbox.chunks { next.append(text, source: source) }
    inbox.chunks.removeAll(keepingCapacity: true)
    log = next
  }

  private func stop() {
    stopEvents?()
    stopEvents = nil
    guard running else { return }
    running = false
    let id = streamId
    let backend = store.backend
    Task { _ = try? await backend?.request(ArgusProtocol.Commands.DebugStopStream.self, .init(streamId: id)) }
  }
}

/// Not observed, so filling it doesn't redraw the view.
@MainActor
private final class LogInbox {
  var chunks: [(String, DebugLogEntry.Source)] = []
}

private struct LogLine: View {
  @Environment(\.theme) private var theme
  let entry: DebugLogEntry

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      if let time = entry.clockTime {
        Text(time).foregroundStyle(theme.textMuted).fixedSize()
      }
      Text(entry.message).foregroundStyle(color)
    }
    .font(.scaled(size: 11, design: .monospaced))
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var color: Color {
    switch entry.level {
    case .error: theme.error
    case .warning: theme.warning
    case .verbose, .debug: theme.textMuted
    case .log, .info: theme.text
    case nil: entry.source == .stderr ? theme.error : theme.textSecondary
    }
  }
}
