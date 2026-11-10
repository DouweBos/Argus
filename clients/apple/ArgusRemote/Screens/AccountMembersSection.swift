import ArgusUI
import SwiftUI

/// Settings → Account, signed in: who is waiting to join, each reviewed with a code.
struct AccountRequestsGroup: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app
  @State private var reviewing: AccountJoinRequestInfo?

  private var account: AccountStore { app.account }

  var body: some View {
    if !account.requests.isEmpty {
      SettingsGroup(
        "Waiting to join",
        footer: "Approve only a device or computer you just signed in on or started linking. You'll compare a code on both screens."
      ) {
        ForEach(account.requests) { request in
          let member = request.subject?.member
          AccountMemberRow(
            icon: AccountMemberText.icon(member), tint: theme.accent, name: member?.name ?? "Unknown",
            detail: AccountMemberText.kind(member)
          ) {
            Btn(label: "Deny", tone: .ghost, small: true, hugs: true) {
              Task { await account.deny(request.requestId) }
            }
            Btn(label: "Review", small: true, hugs: true) { reviewing = request }
          }
        }
      }
      .sheet(item: $reviewing) { request in
        ApproveJoinView(request: request).environment(app)
      }
    }
  }
}

/// Settings → Account, signed in: the devices on the account, with rename and remove.
struct AccountDevicesGroup: View {
  @Environment(\.theme) private var theme
  @Environment(AppStore.self) private var app

  @State private var removing: AccountMember?
  @State private var renaming: AccountMember?
  @State private var draft = ""

  private var account: AccountStore { app.account }
  private var devices: [AccountMember] { account.members.filter { $0.role == .device } }

  var body: some View {
    SettingsGroup("Devices", footer: "Removing a device disconnects it from every computer on your account.") {
      ForEach(devices, id: \.id) { device in
        let isSelf = device.id == account.memberId
        AccountMemberRow(
          icon: AccountMemberText.icon(device), tint: theme.textSecondary,
          name: isSelf ? "\(device.name) (this phone)" : device.name,
          detail: AccountMemberText.detail(device, code: account.approvalCode(for: device.id))
        ) {
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
              .font(.scaled(size: 17))
              .foregroundStyle(theme.textSecondary)
              .frame(width: 32, height: 32)
              .contentShape(.rect)
              .accessibilityLabel("Manage \(device.name)")
          }
        }
      }
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
}

/// A device or computer on the account: its kind's symbol, name and detail, then its actions.
private struct AccountMemberRow<Actions: View>: View {
  @Environment(\.theme) private var theme
  let icon: String
  let tint: Color
  let name: String
  let detail: String
  @ViewBuilder let actions: Actions

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: icon)
        .font(.scaled(size: 15))
        .foregroundStyle(tint)
        .frame(width: TextScale.shared(24))
      VStack(alignment: .leading, spacing: 2) {
        Text(name)
          .font(.scaled(size: 15))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        Text(detail)
          .font(.scaled(size: 13))
          .foregroundStyle(theme.textSecondary)
          .lineLimit(1)
      }
      Spacer(minLength: 6)
      actions
    }
  }
}
