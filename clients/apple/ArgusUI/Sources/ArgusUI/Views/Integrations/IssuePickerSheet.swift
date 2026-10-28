import ArgusCore
import SwiftUI

/// Find Linear issues to start agents on: the connected user's open ones, or
/// a search. Several can be picked; each gets its own worktree and agent.
public struct IssuePickerSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  @Binding var selection: [HostStore.LinearIssue]

  @State private var query = ""
  @State private var results: [HostStore.LinearIssue] = []
  @State private var searching = true
  @State private var error: String?

  public init(selection: Binding<[HostStore.LinearIssue]>) {
    _selection = selection
  }

  public var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 10) {
        ThemedTextField(placeholder: "Search, ENG-123 or an issue link", text: $query, input: .code)
          .padding(.horizontal)
        content
      }
      .padding(.top, 10)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .background(theme.bg)
      .navigationTitle("Linear issues")
      .inlineNavigationTitle()
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }.foregroundStyle(theme.accent)
        }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
    #if os(macOS)
      .frame(minWidth: 440, minHeight: 420)
    #endif
    .task(id: query) { await search() }
  }

  @ViewBuilder private var content: some View {
    if let error {
      MutedText(error).padding(.horizontal)
    } else if results.isEmpty {
      if searching {
        Loading(label: "Asking Linear…").frame(maxWidth: .infinity)
      } else {
        MutedText(query.isEmpty ? "No open issues assigned to you." : "No issues match.")
          .padding(.horizontal)
      }
    } else {
      List(results) { issue in row(issue) }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }
  }

  private func row(_ issue: HostStore.LinearIssue) -> some View {
    let picked = selection.contains { $0.id == issue.id }
    return Button {
      if picked {
        selection.removeAll { $0.id == issue.id }
      } else {
        selection.append(issue)
      }
    } label: {
      HStack(spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text(issue.title)
            .font(.scaled(size: 15))
            .foregroundStyle(theme.text)
            .lineLimit(2)
          Text("\(issue.identifier) · \(issue.state.name)")
            .font(.scaled(size: 12, design: .monospaced))
            .foregroundStyle(theme.textMuted)
        }
        Spacer(minLength: 8)
        if picked {
          Image(systemName: Icon.check)
            .font(.scaled(size: 13, weight: .bold))
            .foregroundStyle(theme.accent)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, 6)
      .contentShape(Rectangle())
    }
    .buttonStyle(.argusPlain)
    .listRowBackground(theme.bgSecondary)
  }

  private func search() async {
    // Typing restarts the task; only a pause asks Linear.
    if !query.isEmpty {
      try? await Task.sleep(for: .milliseconds(250))
      guard !Task.isCancelled else { return }
    }
    searching = true
    defer { searching = false }
    do {
      let found = try await host.linearIssues(query: query)
      guard !Task.isCancelled else { return }
      results = found
      error = nil
    } catch {
      guard !Task.isCancelled else { return }
      self.error = HostStore.describe(error)
    }
  }
}

/// The issues picked for a start, each removable.
public struct PickedIssueChips: View {
  @Binding var issues: [HostStore.LinearIssue]

  public init(issues: Binding<[HostStore.LinearIssue]>) {
    _issues = issues
  }

  public var body: some View {
    FlowRow(spacing: 6, rowSpacing: 6) {
      ForEach(issues) { issue in
        Chip(label: "\(issue.identifier) \(issue.title)", icon: Icon.close, tone: .accent) {
          issues.removeAll { $0.id == issue.id }
        }
        .accessibilityLabel("Remove \(issue.identifier)")
      }
    }
  }
}
