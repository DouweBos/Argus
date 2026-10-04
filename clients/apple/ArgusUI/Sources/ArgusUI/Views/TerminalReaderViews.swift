import ArgusCore
import SwiftUI

/// A session's terminals on the computer, for following a dev server from
/// the phone. Read-only: typing into a shell stays with the desktop.
public struct SessionTerminalsList: View {
  @Environment(HostStore.self) private var host
  let sessionId: String
  let open: (ArgusProtocol.RemoteTerminal) -> Void
  @State private var terminals: [ArgusProtocol.RemoteTerminal]?

  public init(sessionId: String, open: @escaping (ArgusProtocol.RemoteTerminal) -> Void) {
    self.sessionId = sessionId
    self.open = open
  }

  public var body: some View {
    List {
      if let terminals {
        if terminals.isEmpty {
          EmptyState(
            icon: Icon.terminal, title: "No terminals running",
            body: "Shells and run commands started on the computer show up here.")
          .listRowBackground(Color.clear)
        }
        ForEach(terminals, id: \.id) { terminal in
          Button { open(terminal) } label: {
            Label(
              Self.title(terminal),
              systemImage: terminal.runTitle == nil ? Icon.terminal : Icon.play)
          }
        }
      } else {
        Loading(label: "Reading terminals…").listRowBackground(Color.clear)
      }
    }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) {
      terminals = await host.listTerminals(sessionId: sessionId)
    }
  }

  public static func title(_ terminal: ArgusProtocol.RemoteTerminal) -> String {
    terminal.title ?? terminal.runTitle ?? "Shell"
  }
}

/// One terminal's output, following the tail as it grows. Streams when the
/// computer can; an older one is polled every two seconds instead.
public struct TerminalOutputView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  let terminalId: String
  @State private var output = TerminalText()
  @State private var exitCode: Int?
  @State private var streaming = false
  @State private var gone = false

  public init(terminalId: String) {
    self.terminalId = terminalId
  }

  public var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          if output.truncated {
            MutedText("Showing the most recent output.")
          }
          Text(output.text)
            .font(.system(size: 12, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
          if let exitCode {
            Banner(
              text: "Exited with code \(exitCode)",
              tone: exitCode == 0 ? .muted : .warning)
          }
          if gone {
            Banner(text: "This terminal has closed on the computer.", tone: .muted)
          }
          Color.clear.frame(height: 1).id("end")
        }
        .padding(12)
      }
      .onChange(of: output.text) { proxy.scrollTo("end", anchor: .bottom) }
    }
    .background(theme.bg)
    // A dropped connection loses its subscription, so a reconnect follows again.
    .task(id: host.connection == .ready) {
      guard host.connection == .ready, !gone else { return }
      guard let stop = await host.followTerminal(id: terminalId, deliver: apply) else {
        streaming = false
        return
      }
      streaming = true
      await withTaskCancellationHandler {
        while !Task.isCancelled { try? await Task.sleep(for: .seconds(3600)) }
      } onCancel: {
        Task { @MainActor in stop() }
      }
    }
    .liveRefresh(enabled: host.connection == .ready && !streaming && !gone, every: .seconds(2)) {
      if let next = await host.readTerminal(id: terminalId) {
        output.reset()
        output.append(Data(next.output.utf8))
        output.truncated = next.truncated
        exitCode = next.running ? nil : Int(next.exitCode ?? 0)
      } else if !output.text.isEmpty || exitCode != nil {
        gone = true
      }
    }
  }

  private func apply(_ outputs: [TerminalFeed.Output]) {
    for item in outputs {
      switch item {
      case .reset:
        output.reset()
        exitCode = nil
      case .data(let data): output.append(data)
      case .exit(let code): exitCode = code
      }
    }
  }
}
