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

/// One terminal's output, following the tail as it grows.
public struct TerminalOutputView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  let terminalId: String
  @State private var read: ArgusProtocol.RemoteTerminalOutput?
  @State private var gone = false

  public init(terminalId: String) {
    self.terminalId = terminalId
  }

  public var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 8) {
          if read?.truncated == true {
            MutedText("Showing the most recent output.")
          }
          Text(read?.output ?? "")
            .font(.system(size: 12, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
          if let read, !read.running {
            Banner(
              text: "Exited with code \(Int(read.exitCode ?? 0))",
              tone: read.exitCode == 0 ? .muted : .warning)
          }
          if gone {
            Banner(text: "This terminal has closed on the computer.", tone: .muted)
          }
          Color.clear.frame(height: 1).id("end")
        }
        .padding(12)
      }
      .onChange(of: read?.output) { proxy.scrollTo("end", anchor: .bottom) }
    }
    .background(theme.bg)
    .liveRefresh(enabled: host.connection == .ready && !gone, every: .seconds(2)) {
      if let next = await host.readTerminal(id: terminalId) {
        read = next
      } else if read != nil {
        gone = true
      }
    }
  }
}
