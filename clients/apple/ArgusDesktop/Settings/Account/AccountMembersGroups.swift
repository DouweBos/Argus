import ArgusCore
import ArgusUI
import SwiftUI

/// Computers and devices waiting to join, each reviewed with a code.
struct AccountRequestsGroup: View {
  @Environment(AccountStore.self) private var account
  @State private var reviewing: AccountJoinRequestInfo?

  var body: some View {
    if !account.requests.isEmpty {
      SettingsGroup(
        "Waiting to join",
        footer: "Approve only a device or computer you just signed in on or started linking. You'll compare a code on both screens."
      ) {
        ForEach(account.requests) { request in
          HStack {
            Image(systemName: AccountMemberText.icon(request.subject?.member))
            Text(request.subject?.member?.name ?? "Unknown")
            Text(AccountMemberText.kind(request.subject?.member)).foregroundStyle(.secondary)
            Spacer()
            Button("Deny") { Task { await account.deny(request.requestId) } }
              .buttonStyle(.secondary)
            Button("Review…") { reviewing = request }
              .buttonStyle(.accent)
          }
        }
      }
      .sheet(item: $reviewing) { request in
        AccountApprovalPanel(request: request)
      }
    }
  }
}

/// Compare the code with the device or computer asking, then add it.
struct AccountApprovalPanel: View {
  @Environment(AccountStore.self) private var account
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  let request: AccountJoinRequestInfo

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Approve \(request.subject?.member?.name ?? "this device")").font(.headline)
      switch account.approval {
      case .idle, .working:
        HStack {
          ProgressView().controlSize(.small)
          Text("Checking…").foregroundStyle(.secondary)
        }
      case .confirm(let sas, let name, _):
        Text("\(name) shows a code too. Only add it if they're the same:").foregroundStyle(.secondary)
        AccountCodeText(sas: sas)
        HStack {
          Spacer()
          Button("They Don't Match", role: .destructive) {
            Task {
              await account.denyApproval()
              dismiss()
            }
          }
          .buttonStyle(.secondary)
          Button("Codes Match — Add It") { Task { await account.confirmApproval() } }
            .buttonStyle(.accent)
            .keyboardShortcut(.defaultAction)
        }
      case .done(let name, _):
        Label("\(name) is on your account.", systemImage: "checkmark.circle").foregroundStyle(theme.success)
        HStack {
          Spacer()
          Button("Done") { dismiss() }.buttonStyle(.accent).keyboardShortcut(.defaultAction)
        }
      case .failed(let message):
        SettingsError(text: message)
        HStack {
          Spacer()
          Button("Close") { dismiss() }.buttonStyle(.secondary)
        }
      }
    }
    .padding(20)
    .frame(width: 400)
    .task { await account.approve(request) }
    .onDisappear {
      if case .confirm = account.approval { Task { await account.denyApproval() } }
      account.resetApproval()
    }
  }
}

/// The phones, Macs and desktop windows on the account.
struct AccountDevicesGroup: View {
  @Environment(AccountStore.self) private var account
  @State private var removing: AccountMember?
  @State private var renaming: AccountMember?

  var body: some View {
    SettingsGroup("Devices", footer: "Removing a device disconnects it from every host on your account.") {
      ForEach(account.members.filter { $0.role == .device }, id: \.id) { device in
        let isSelf = device.id == account.memberId
        HStack {
          Image(systemName: AccountMemberText.icon(device))
          Text(isSelf ? "\(device.name) (this Mac)" : device.name)
          Text("\(AccountMemberText.kind(device)) · added \(AccountMemberText.added(device))")
            .foregroundStyle(.secondary)
          Spacer()
          Button("Rename…") { renaming = device }.buttonStyle(.secondary)
          if !isSelf {
            Button("Remove…", role: .destructive) { removing = device }.buttonStyle(.secondary)
          }
        }
      }
    }
    .confirmationDialog(
      "Remove \(removing?.name ?? "") from your account?",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      presenting: removing
    ) { device in
      Button("Remove", role: .destructive) { Task { await account.remove(memberId: device.id) } }
    } message: { _ in
      Text("It's disconnected from every host on your account and has to be approved again to come back.")
    }
    .sheet(item: $renaming) { member in
      AccountRenameSheet(member: member)
    }
  }
}

/// A new name for a device or host on the account.
struct AccountRenameSheet: View {
  @Environment(AccountStore.self) private var account
  @Environment(\.dismiss) private var dismiss
  let member: AccountMember
  @State private var name = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Rename \(member.name)").font(.headline)
      TextField("Name", text: $name)
        .textFieldStyle(.roundedBorder)
        .onSubmit(save)
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }.buttonStyle(.secondary).keyboardShortcut(.cancelAction)
        Button("Rename", action: save)
          .buttonStyle(.accent)
          .keyboardShortcut(.defaultAction)
          .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
      }
    }
    .padding(20)
    .frame(width: 360)
    .onAppear { name = member.name }
  }

  private func save() {
    guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    Task { await account.rename(memberId: member.id, to: name) }
    dismiss()
  }
}

enum AccountMemberText {
  static func icon(_ member: AccountMember?) -> String {
    switch member?.kind {
    case "ios": "iphone"
    case "mac": "laptopcomputer"
    default: "desktopcomputer"
    }
  }

  static func kind(_ member: AccountMember?) -> String {
    guard let member else { return "" }
    if member.role == .host { return member.platform == "linux" ? "Linux host" : "Mac host" }
    switch member.kind {
    case "ios": return "iPhone"
    case "mac": return "Mac app"
    default: return "Desktop app"
    }
  }

  static func added(_ member: AccountMember) -> String {
    Date(timeIntervalSince1970: member.createdAt / 1000).formatted(date: .abbreviated, time: .omitted)
  }
}
