import ArgusCore
import ArgusUI
import SwiftUI

/// Settings → Argus Account: sign in once and every host on the account is
/// listed in Hosts with no pairing code; this Mac's own host joins on its own.
struct AccountSettingsTab: View {
  @Environment(AccountStore.self) private var account
  @State private var resetting = false

  var body: some View {
    SettingsPage {
      switch account.phase {
      case .loading, .settingUp:
        SettingsGroup {
          HStack {
            ProgressView().controlSize(.small)
            Text("Setting up your account…").foregroundStyle(.secondary)
          }
        }
      // Signing in keeps the form, so a web sign-in that comes back shows where it left.
      case .signedOut, .signingIn:
        AccountSignInSection()
      case .awaitingApproval:
        if let notice = account.resetNotice {
          AccountResetNoticeBanner(notice: notice, deviceNoun: "Mac") { account.dismissResetNotice() }
        }
        AccountProfileHeader()
        AccountJoinSection()
        MacHostLinkSection()
        resetGroup(
          "Nobody left to approve?",
          footer: "Lost every device and computer on your account? Reset it from this Mac and link your other computers again.")
      case .ready:
        if account.signInNeeded != nil { AccountSignInSection() }
        AccountProfileHeader()
        AccountOverview()
        resetGroup(
          "Reset account",
          footer: "Only when every other device and computer on your account is lost. Everything leaves the account and has to join again.")
      }
    }
    .sheet(isPresented: $resetting) {
      AccountResetSheet(account: account, deviceNoun: "Mac") { resetting = false }
        .frame(width: 420)
    }
    // Presence moves while this is open: a host going quiet or coming back,
    // and someone may be waiting to join.
    .liveRefresh(enabled: account.isSignedIn, every: AccountStore.presencePollInterval) {
      await account.refresh()
    }
  }
}

extension AccountSettingsTab {
  @ViewBuilder fileprivate func resetGroup(_ title: String, footer: String) -> some View {
    if account.canReset {
      SettingsGroup(title, footer: footer) {
        HStack {
          Spacer()
          Button("Reset Account…", role: .destructive) { resetting = true }
            .buttonStyle(.secondary)
        }
      }
    }
  }
}

/// Signed in: the safety code, this Mac's host, the other hosts, sign out.
private struct AccountOverview: View {
  @Environment(AccountStore.self) private var account
  @Environment(\.theme) private var theme
  @State private var code = ""
  @State private var confirmingSignOut = false
  @State private var removing: AccountStore.Host?
  @State private var renaming: AccountMember?

  var body: some View {
    AccountRequestsGroup()

    SettingsGroup(
      "Safety code",
      footer: "The same on every device on your account. If one ever shows a different code, it's looking at a different account."
    ) {
      Text(account.safetyCode ?? "—")
        .font(.scaled(size: 20, weight: .semibold, design: .monospaced))
        .textSelection(.enabled)
      if let logError = account.logError {
        SettingsError(text: "The account service sent changes that don't check out (\(logError.rawValue)). Nothing was applied.")
      }
    }

    SettingsGroup(
      "This Mac",
      footer: account.localHostLinked
        ? "This Mac's host is on your account, so your phone and other computers reach it without pairing."
        : "Put this Mac's host on your account so your phone and other computers reach it without pairing."
    ) {
      if account.localHostLinked {
        Label("On your account", systemImage: "checkmark.circle").foregroundStyle(theme.success)
      } else {
        HStack {
          Text(account.localLinkError ?? "Not on your account yet.").foregroundStyle(.secondary)
          Spacer()
          if account.localLinkConflict {
            Button("Move to This Account") { Task { await account.moveLocalHost() } }
              .buttonStyle(.accent)
          } else {
            Button("Add this Mac") { Task { await account.linkLocalHost() } }
              .buttonStyle(.accent)
          }
        }
      }
    }

    SettingsGroup(
      "Hosts",
      footer: "Attach them in Settings → Hosts. A host that hasn't checked in for 15 minutes shows as offline; it's still tried at its last addresses."
    ) {
      let others = account.hosts.filter { !$0.isLocal }
      if others.isEmpty {
        Text("No other hosts yet. Run `argus-host login`, or sign in to Argus on the other computer, and add the code it shows below.")
          .foregroundStyle(.secondary)
      }
      ForEach(others) { host in
        HStack {
          StatusDot(tone: host.online ? .success : .muted)
          Text(host.name)
          Text(AccountPresenceText.text(online: host.online, lastSeen: host.lastSeen))
            .foregroundStyle(.secondary)
          Spacer()
          Button("Rename…") { renaming = host.member }
            .buttonStyle(.secondary)
          Button("Remove…", role: .destructive) { removing = host }
            .buttonStyle(.secondary)
        }
      }
    }

    SettingsGroup("Add a host", footer: "Type the code the other computer shows, then compare the 6-digit codes.") {
      AddHostByCode(code: $code)
    }

    AccountDevicesGroup()

    SettingsGroup(footer: "Takes this Mac off the account and deletes its account key. Paired hosts keep working.") {
      HStack {
        Spacer()
        Button("Sign Out…", role: .destructive) { confirmingSignOut = true }
          .buttonStyle(.secondary)
      }
      SettingsError(text: account.error)
    }
    .confirmationDialog("Sign out of your Argus account?", isPresented: $confirmingSignOut) {
      Button("Sign Out", role: .destructive) { Task { await account.signOut() } }
    }
    .confirmationDialog(
      "Remove \(removing?.name ?? "") from your account?",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
    ) {
      Button("Remove", role: .destructive) {
        if let host = removing { Task { await account.remove(memberId: host.id) } }
      }
    } message: {
      Text("Your devices stop connecting to it through the account. Link it again with a new code.")
    }
    .sheet(item: $renaming) { member in
      AccountRenameSheet(member: member)
    }
  }
}

/// Approving another computer's link code from this Mac.
private struct AddHostByCode: View {
  @Environment(AccountStore.self) private var account
  @Environment(\.theme) private var theme
  @Binding var code: String

  var body: some View {
    switch account.link {
    case .idle, .failed:
      HStack {
        TextField("WDJB-MJHT", text: $code)
          .textFieldStyle(.roundedBorder)
          .font(.system(.body, design: .monospaced))
          .onSubmit(submit)
        Button("Continue", action: submit)
          .buttonStyle(.accent)
          .disabled(AccountCodec.normalizeUserCode(code).count != 9)
      }
      if case .failed(let message) = account.link { SettingsError(text: message) }
    case .working(let message):
      HStack {
        ProgressView().controlSize(.small)
        Text(message).foregroundStyle(.secondary)
      }
    case .confirm(let sas, let hostName):
      VStack(alignment: .leading, spacing: 8) {
        Text("\(hostName) shows a code too. Only confirm if they're the same:").foregroundStyle(.secondary)
        Text(AccountMemberText.groupedCode(sas))
          .font(.scaled(size: 28, weight: .semibold, design: .monospaced))
          .accessibilityLabel("Check code \(sas)")
        HStack {
          Button("Codes Match") { Task { await account.confirmLink() } }
            .buttonStyle(.accent)
            .keyboardShortcut(.defaultAction)
          Button("They Don't Match", role: .destructive) { Task { await account.denyLink() } }
            .buttonStyle(.secondary)
        }
      }
    case .done(let hostName):
      HStack {
        Label("\(hostName) is on your account.", systemImage: "checkmark.circle").foregroundStyle(theme.success)
        Spacer()
        Button("Add Another") {
          code = ""
          account.resetLink()
        }
        .buttonStyle(.secondary)
      }
    }
  }

  private func submit() {
    guard AccountCodec.normalizeUserCode(code).count == 9 else { return }
    Task { await account.link(code: code) }
  }
}

/// "Online", or "Offline · last seen 2 hr. ago".
