import ArgusUI
import SwiftUI

/// Settings → Account, signed in: who is waiting to join, and the devices on
/// the account with rename and remove.
struct AccountMembersSection: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  @State private var reviewing: AccountJoinRequestInfo?
  @State private var removing: AccountMember?
  @State private var renaming: AccountMember?
  @State private var draft = ""

  private var account: AccountStore { app.account }
  private var devices: [AccountMember] { account.members.filter { $0.role == .device } }

  var body: some View {
    if !account.requests.isEmpty {
      Field(
        label: "Waiting to join",
        caption: "Approve only a device or computer you just signed in on or started linking."
      ) {
        ForEach(account.requests) { request in
          requestRow(request)
        }
      }
    }

    Field(label: "Devices") {
      ForEach(devices, id: \.id) { device in
        deviceRow(device)
      }
    }
    .sheet(item: $reviewing) { request in
      ApproveJoinView(request: request).environment(app)
    }
    .alert(
      "Remove “\(removing?.name ?? "")” from your account?",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      presenting: removing
    ) { device in
      Button("Cancel", role: .cancel) {}
      Button("Remove", role: .destructive) { Task { await account.remove(memberId: device.id) } }
    } message: { _ in
      Text("It's disconnected from every computer on your account and has to be approved again to come back.")
    }
    .alert(
      "Rename “\(renaming?.name ?? "")”",
      isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } }),
      presenting: renaming
    ) { member in
      TextField("Name", text: $draft)
      Button("Cancel", role: .cancel) {}
      Button("Rename") { Task { await account.rename(memberId: member.id, to: draft) } }
    }
  }

  private func requestRow(_ request: AccountJoinRequestInfo) -> some View {
    let member = request.subject?.member
    return Card {
      HStack(spacing: 8) {
        Image(systemName: Self.icon(member)).foregroundStyle(theme.accent)
        VStack(alignment: .leading, spacing: 2) {
          BodyText(member?.name ?? "Unknown", lineLimit: 1)
          MutedText(Self.kindLabel(member), lineLimit: 1)
        }
        Spacer(minLength: 6)
        Btn(label: "Deny", tone: .ghost, small: true, hugs: true) {
          Task { await account.deny(request.requestId) }
        }
        Btn(label: "Review", small: true, hugs: true) { reviewing = request }
      }
    }
  }

  private func deviceRow(_ device: AccountMember) -> some View {
    let isSelf = device.id == account.memberId
    return Card {
      HStack(spacing: 8) {
        Image(systemName: Self.icon(device)).foregroundStyle(theme.textSecondary)
        VStack(alignment: .leading, spacing: 2) {
          BodyText(isSelf ? "\(device.name) (this phone)" : device.name, lineLimit: 1)
          MutedText("\(Self.kindLabel(device)) · added \(Self.added(device))", lineLimit: 1)
        }
        Spacer(minLength: 6)
        Menu {
          Button("Rename…", systemImage: "pencil") {
            draft = device.name
            renaming = device
          }
          if !isSelf {
            Button("Remove…", systemImage: "trash", role: .destructive) { removing = device }
          }
        } label: {
          Image(systemName: "ellipsis.circle")
            .foregroundStyle(theme.textSecondary)
            .accessibilityLabel("Manage \(device.name)")
        }
      }
    }
  }

  static func icon(_ member: AccountMember?) -> String {
    switch member?.kind {
    case "ios": "iphone"
    case "mac": "laptopcomputer"
    default: Icon.desktop
    }
  }

  static func kindLabel(_ member: AccountMember?) -> String {
    guard let member else { return "" }
    if member.role == .host { return member.platform == "linux" ? "Linux computer" : "Mac computer" }
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
