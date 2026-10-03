import ArgusUI
import GroveKit
import SwiftUI

/// Bisect, as Electron's `BisectView`: start from a good and a bad ref, mark
/// each commit git checks out, and land on the first bad one.
struct BisectView: View {
  @Environment(HostStore.self) private var store
  @Environment(DesktopModel.self) private var model
  let workspace: GitWorkspace

  @State private var status: ArgusProtocol.BisectStatus?
  @State private var finished: ArgusProtocol.BisectStepFirstBadCommit?
  @State private var log: [BisectLogEntry] = []
  @State private var loadError: String?
  @State private var goodRef = ""
  @State private var badRef = "HEAD"

  var body: some View {
    VStack(spacing: 0) {
      GitToolHeader(title: "Bisect", caption: "Find the commit that introduced a bug by testing the ones git picks.") {
        if status?.active == true || finished != nil {
          Button("Reset Bisect") { reset() }.disabled(busy)
        }
      }
      Divider()
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          if let loadError {
            Label(loadError, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
          }
          if let finished {
            BisectFoundCard(commit: finished, busy: busy, reveal: { reveal(finished.hash) }, reset: reset)
          } else if let status, status.active {
            BisectStepCard(status: status, busy: busy) { mark($0) }
          } else if status != nil {
            BisectStartForm(goodRef: $goodRef, badRef: $badRef, refs: refNames, busy: busy, start: start)
          } else if loadError == nil {
            ProgressView().controlSize(.small).frame(maxWidth: .infinity)
          }
          if !log.isEmpty { BisectLogList(entries: log) }
        }
        .padding(16)
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .task(id: workspace.generation) { await load() }
  }

  private var id: String { workspace.sessionId }
  private var busy: Bool { workspace.hostBusy != nil }

  private var refNames: [String] {
    workspace.refs.localBranches.map(\.name) + workspace.refs.tags.map(\.name)
  }

  private func start() {
    let good = goodRef.trimmingCharacters(in: .whitespaces)
    let bad = badRef.trimmingCharacters(in: .whitespaces)
    finished = nil
    Task {
      let step = await workspace.host(
        ArgusProtocol.Commands.GitBisectStart.self, .init(id: id, goodRef: good, badRef: bad),
        label: "Starting bisect", track: .bisect)
      finished = step?.firstBadCommit
      await load()
    }
  }

  private func mark(_ verdict: BisectStepCard.Verdict) {
    Task {
      let step: ArgusProtocol.BisectStep? =
        switch verdict {
        case .good:
          await workspace.host(
            ArgusProtocol.Commands.GitBisectGood.self, .init(id: id), label: "Marking good", track: .bisect)
        case .bad:
          await workspace.host(
            ArgusProtocol.Commands.GitBisectBad.self, .init(id: id), label: "Marking bad", track: .bisect)
        case .skip:
          await workspace.host(
            ArgusProtocol.Commands.GitBisectSkip.self, .init(id: id), label: "Skipping", track: .bisect)
        }
      if let first = step?.firstBadCommit { finished = first }
      await load()
    }
  }

  private func reset() {
    Task {
      await workspace.host(
        ArgusProtocol.Commands.GitBisectReset.self, .init(id: id), label: "Resetting bisect", track: .bisect)
      finished = nil
      log = []
      await load()
    }
  }

  private func reveal(_ sha: String) {
    model.navigate(.sessionGit(id: id, view: .history))
    Task { await workspace.history.reveal(sha) }
  }

  private func load() async {
    switch await GitToolRead.request(store, ArgusProtocol.Commands.GitBisectStatus.self, .init(id: id)) {
    case .success(let next):
      status = next
      loadError = nil
      if let first = next.firstBadCommit {
        finished = ArgusProtocol.BisectStepFirstBadCommit(hash: first.hash, subject: first.subject)
      }
    case .failure(let error):
      loadError = error.message
    }
    let active = status?.active == true || finished != nil
    log = active ? BisectLogEntry.parse((try? await workspace.repository.bisectLog()) ?? []) : []
  }
}

/// No bisect running: the two ends of the range.
private struct BisectStartForm: View {
  @Binding var goodRef: String
  @Binding var badRef: String
  let refs: [String]
  let busy: Bool
  let start: () -> Void

  var body: some View {
    Form {
      Section {
        refField("Good", text: $goodRef, prompt: "An older ref that works, e.g. v1.2.0")
        refField("Bad", text: $badRef, prompt: "A newer ref that's broken, e.g. HEAD")
      } footer: {
        HStack {
          Text("Git checks out commits in between for you to test.").foregroundStyle(.secondary)
          Spacer()
          Button("Start Bisect", action: start)
            .keyboardShortcut(.defaultAction)
            .disabled(busy || goodRef.trimmingCharacters(in: .whitespaces).isEmpty
              || badRef.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
    }
    .formStyle(.grouped)
    .scrollDisabled(true)
    .fixedSize(horizontal: false, vertical: true)
  }

  private func refField(_ label: String, text: Binding<String>, prompt: String) -> some View {
    HStack {
      TextField(label, text: text, prompt: Text(prompt))
      Menu {
        ForEach(refs, id: \.self) { ref in Button(ref) { text.wrappedValue = ref } }
      } label: {
        Image(systemName: "chevron.up.chevron.down")
      }
      .menuStyle(.borderlessButton)
      .menuIndicator(.hidden)
      .fixedSize()
      .disabled(refs.isEmpty)
      .help("Pick a branch or tag")
    }
  }
}

/// Bisecting: the commit to test and the verdicts.
private struct BisectStepCard: View {
  @Environment(\.theme) private var theme
  let status: ArgusProtocol.BisectStatus
  let busy: Bool
  let mark: (Verdict) -> Void

  enum Verdict { case good, bad, skip }

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Image(systemName: "scope").foregroundStyle(theme.accent)
        Text("Test this commit").font(.headline)
        Spacer()
        if let remaining = status.remaining {
          Text("~\(Int(remaining)) revisions left").font(.callout).foregroundStyle(.secondary)
        }
      }
      if let ref = status.currentRef {
        Text(String(ref.prefix(12))).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
      }
      if let subject = status.currentSubject {
        Text(subject).textSelection(.enabled)
      }
      HStack(spacing: 8) {
        Button { mark(.good) } label: { Label("Good", systemImage: "checkmark") }
        Button { mark(.bad) } label: { Label("Bad", systemImage: "xmark") }
        Button { mark(.skip) } label: { Label("Skip", systemImage: "forward") }
      }
      .disabled(busy)
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.bgSecondary, in: .rect(cornerRadius: 8))
  }
}

/// Bisect done: the first bad commit.
private struct BisectFoundCard: View {
  @Environment(\.theme) private var theme
  let commit: ArgusProtocol.BisectStepFirstBadCommit
  let busy: Bool
  let reveal: () -> Void
  let reset: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Label("First bad commit found", systemImage: "flag.checkered").font(.headline)
        .foregroundStyle(theme.error)
      Text(String(commit.hash.prefix(12))).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
      if !commit.subject.isEmpty { Text(commit.subject).textSelection(.enabled) }
      HStack(spacing: 8) {
        Button("Show in History", action: reveal).keyboardShortcut(.defaultAction)
        Button("Copy SHA") { Clipboard.copy(commit.hash) }
        Button("Reset Bisect", action: reset).disabled(busy)
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(theme.errorSoft, in: .rect(cornerRadius: 8))
  }
}

/// One verdict from `git bisect log`.
struct BisectLogEntry: Identifiable {
  let id: Int
  let verdict: String
  let sha: String
  let subject: String

  /// `# good: [sha] subject` lines; the `git bisect …` replay lines repeat them.
  static func parse(_ lines: [String]) -> [BisectLogEntry] {
    lines.enumerated().compactMap { index, line in
      guard line.hasPrefix("# "), let colon = line.firstIndex(of: ":") else { return nil }
      let verdict = String(line[line.index(line.startIndex, offsetBy: 2)..<colon])
      guard ["good", "bad", "skip", "first bad commit"].contains(verdict) else { return nil }
      var rest = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
      var sha = ""
      if rest.hasPrefix("["), let close = rest.firstIndex(of: "]") {
        sha = String(rest[rest.index(after: rest.startIndex)..<close])
        rest = rest[rest.index(after: close)...].trimmingCharacters(in: .whitespaces)
      }
      return BisectLogEntry(id: index, verdict: verdict, sha: sha, subject: rest)
    }
  }
}

private struct BisectLogList: View {
  @Environment(\.theme) private var theme
  let entries: [BisectLogEntry]

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Log").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
      ForEach(entries) { entry in
        HStack(spacing: 8) {
          Badge(label: entry.verdict, tone: tone(entry.verdict))
          Text(String(entry.sha.prefix(8))).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
          Text(entry.subject).lineLimit(1).truncationMode(.tail)
        }
        .font(.system(size: 12))
      }
    }
  }

  private func tone(_ verdict: String) -> Tone {
    switch verdict {
    case "good": .success
    case "bad", "first bad commit": .danger
    default: .muted
    }
  }
}
