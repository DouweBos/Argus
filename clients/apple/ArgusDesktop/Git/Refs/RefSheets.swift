import ArgusKit
import ArgusUI
import GroveKit
import SwiftUI

/// Push: remote, branch, force-with-lease, upstream and tags, as Peacock's `PushDialog`.
struct PushSheet: View {
  let remotes: [String]
  let branch: String
  let hasUpstream: Bool
  let dismiss: () -> Void
  let submit: (ArgusProtocol.CommandsTypes.GitPushV2Params) -> Void
  let sessionId: String
  @State private var remote = ""
  @State private var target = ""
  @State private var forceWithLease = false
  @State private var setUpstream = false
  @State private var tags = "none"

  var body: some View {
    GitSheetLayout(
      title: hasUpstream ? "Push \(branch)" : "Publish \(branch)", primary: hasUpstream ? "Push" : "Publish",
      canSubmit: !remote.isEmpty && !target.isEmpty, cancel: dismiss,
      submit: {
        dismiss()
        submit(
          .init(
            id: sessionId, remote: remote, branch: target, forceWithLease: forceWithLease, setUpstream: setUpstream,
            tags: .init(rawValue: tags)))
      }
    ) {
      Form {
        Picker("Remote", selection: $remote) {
          ForEach(remotes, id: \.self) { Text($0).tag($0) }
        }
        TextField("Remote branch", text: $target)
        Picker("Tags", selection: $tags) {
          Text("None").tag("none")
          Text("Annotated tags on pushed commits").tag("follow")
          Text("All tags").tag("all")
        }
        Toggle("Set upstream", isOn: $setUpstream)
        Toggle("Force with lease", isOn: $forceWithLease)
      }
      .formStyle(.grouped)
      .toggleStyle(.argusSwitch)
    }
    .onAppear {
      remote = remotes.contains("origin") ? "origin" : remotes.first ?? ""
      target = branch
      setUpstream = !hasUpstream
    }
  }
}

/// Pull: remote, branch and strategy, as Peacock's `PullDialog`.
struct PullSheet: View {
  let remotes: [String]
  let branch: String
  let initialStrategy: GroveKit.PullStrategy
  let dismiss: () -> Void
  let submit: (_ remote: String, _ branch: String?, _ strategy: ArgusProtocol.CommandsTypes.GitPullV2ParamsStrategy) -> Void
  @State private var remote = ""
  @State private var target = ""
  @State private var strategy = "merge"

  var body: some View {
    GitSheetLayout(
      title: "Pull into \(branch)", primary: "Pull", canSubmit: !remote.isEmpty, cancel: dismiss,
      submit: {
        dismiss()
        submit(remote, target.isEmpty ? nil : target, .init(rawValue: strategy))
      }
    ) {
      Form {
        Picker("Remote", selection: $remote) {
          ForEach(remotes, id: \.self) { Text($0).tag($0) }
        }
        TextField("Remote branch", text: $target, prompt: Text("Upstream"))
        Picker("Strategy", selection: $strategy) {
          Text("Merge").tag("merge")
          Text("Rebase").tag("rebase")
          Text("Fast-forward only").tag("ff-only")
        }
        .pickerStyle(.radioGroup)
      }
      .formStyle(.grouped)
    }
    .onAppear {
      remote = remotes.contains("origin") ? "origin" : remotes.first ?? ""
      strategy =
        switch initialStrategy {
        case .merge: "merge"
        case .rebase: "rebase"
        case .fastForwardOnly: "ff-only"
        }
    }
  }
}

/// New branch: name, start point, checkout.
struct BranchSheet: View {
  let startPoint: String
  let dismiss: () -> Void
  let submit: (_ name: String, _ startPoint: String, _ checkout: Bool) -> Void
  @State private var name = ""
  @State private var start = ""
  @State private var checkout = true

  private var trimmed: String { name.trimmingCharacters(in: .whitespaces) }

  var body: some View {
    GitSheetLayout(
      title: "New Branch", primary: "Create", canSubmit: RefName.isValid(trimmed) && !start.isEmpty,
      cancel: dismiss,
      submit: {
        dismiss()
        submit(trimmed, start, checkout)
      }
    ) {
      Form {
        TextField("Name", text: $name).initialFocus()
        TextField("Start point", text: $start)
        Toggle("Check out the new branch", isOn: $checkout)
      }
      .formStyle(.grouped)
      .toggleStyle(.argusSwitch)
    }
    .onAppear { start = startPoint }
  }
}

/// Merge or rebase: the other branch, and for a merge whether to squash.
struct BranchPickSheet: View {
  let title: String
  let primary: String
  let branches: [String]
  var squashOption = false
  let dismiss: () -> Void
  let submit: (_ branch: String, _ squash: Bool) -> Void
  @State private var branch = ""
  @State private var squash = false

  var body: some View {
    GitSheetLayout(
      title: title, primary: primary, canSubmit: !branch.isEmpty, cancel: dismiss,
      submit: {
        dismiss()
        submit(branch, squash)
      }
    ) {
      Form {
        Picker("Branch", selection: $branch) {
          ForEach(branches, id: \.self) { Text($0).tag($0) }
        }
        if squashOption { Toggle("Squash into one commit", isOn: $squash) }
      }
      .formStyle(.grouped)
      .toggleStyle(.argusSwitch)
    }
    .onAppear { branch = branches.first ?? "" }
  }
}

/// Stash: message, untracked files, keep the index.
struct StashSheet: View {
  let dismiss: () -> Void
  let submit: (_ message: String?, _ includeUntracked: Bool, _ keepIndex: Bool) -> Void
  @State private var message = ""
  @State private var includeUntracked = true
  @State private var keepIndex = false

  var body: some View {
    GitSheetLayout(
      title: "Stash Changes", primary: "Stash", cancel: dismiss,
      submit: {
        dismiss()
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        submit(text.isEmpty ? nil : text, includeUntracked, keepIndex)
      }
    ) {
      Form {
        TextField("Message", text: $message, prompt: Text("Optional")).initialFocus()
        Toggle("Include untracked files", isOn: $includeUntracked)
        Toggle("Keep staged changes", isOn: $keepIndex)
      }
      .formStyle(.grouped)
      .toggleStyle(.argusSwitch)
    }
  }
}

/// New tag: name, target, and a message for an annotated tag.
struct TagSheet: View {
  let target: String
  let dismiss: () -> Void
  let submit: (_ name: String, _ target: String, _ message: String?) -> Void
  @State private var name = ""
  @State private var ref = ""
  @State private var message = ""

  private var trimmed: String { name.trimmingCharacters(in: .whitespaces) }

  var body: some View {
    GitSheetLayout(
      title: "New Tag", primary: "Create", canSubmit: RefName.isValid(trimmed) && !ref.isEmpty,
      cancel: dismiss,
      submit: {
        dismiss()
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        submit(trimmed, ref, text.isEmpty ? nil : text)
      }
    ) {
      Form {
        TextField("Name", text: $name).initialFocus()
        TextField("Target", text: $ref)
        TextField("Message", text: $message, prompt: Text("Annotated tag message (optional)"), axis: .vertical)
          .lineLimit(3...6)
      }
      .formStyle(.grouped)
    }
    .onAppear { ref = target }
  }
}

/// New remote: name and URL.
struct RemoteSheet: View {
  let dismiss: () -> Void
  let submit: (_ name: String, _ url: String) -> Void
  @State private var name = ""
  @State private var url = ""

  var body: some View {
    let cleanName = name.trimmingCharacters(in: .whitespaces)
    let cleanURL = url.trimmingCharacters(in: .whitespaces)
    GitSheetLayout(
      title: "Add Remote", primary: "Add", canSubmit: RefName.isValid(cleanName) && !cleanURL.isEmpty,
      cancel: dismiss,
      submit: {
        dismiss()
        submit(cleanName, cleanURL)
      }
    ) {
      Form {
        TextField("Name", text: $name).initialFocus()
        TextField("URL", text: $url)
      }
      .formStyle(.grouped)
    }
  }
}
