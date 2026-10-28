import ArgusUI
import SwiftUI

/// Approving a phone, Mac or computer that asked to join the account: compare
/// the 6-digit code it shows, then add it.
struct ApproveJoinView: View {
  @Environment(AppStore.self) private var app
  @Environment(\.dismiss) private var dismiss
  let request: AccountJoinRequestInfo

  private var account: AccountStore { app.account }
  private var name: String { request.subject?.member?.name ?? "This device" }

  var body: some View {
    NavigationStack {
      Screen {
        switch account.approval {
        case .idle, .working:
          Loading(label: "Checking \(name)…")
        case .confirm(let sas, let name, _):
          TitleText("Compare the codes")
          MutedText("\(name) shows a code too. Only add it if they're the same.")
          SasCode(sas: sas)
          Btn(label: "Codes match — add it") { Task { await account.confirmApproval() } }
          Btn(label: "They don't match", tone: .danger) {
            Task {
              await account.denyApproval()
              dismiss()
            }
          }
        case .done(let name, let role):
          EmptyState(
            icon: "checkmark.circle", title: "\(name) is on your account",
            body: role == .host
              ? "It shows up under Computers and connects without a QR code."
              : "It can now reach every computer on your account.")
          Btn(label: "Done") { dismiss() }
        case .failed(let message):
          Banner(text: message, tone: .danger)
          Btn(label: "Close", tone: .secondary) { dismiss() }
        }
      }
      .navigationTitle("Approve \(name)")
      .navigationBarTitleDisplayMode(.inline)
    }
    .task { await account.approve(request) }
    .onDisappear {
      if case .confirm = account.approval { Task { await account.denyApproval() } }
      account.resetApproval()
    }
  }
}

/// While the app is open and signed in: someone waiting to join gets an alert
/// wherever the user is, and Review opens the code comparison.
struct JoinRequestPrompt: ViewModifier {
  @Environment(AppStore.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @State private var asking: AccountJoinRequestInfo?
  @State private var reviewing: AccountJoinRequestInfo?
  @State private var seen: Set<String> = []

  /// A request lives 10 minutes; checking every 30 s while open catches it.
  private static let interval: Duration = .seconds(30)

  func body(content: Content) -> some View {
    content
      .task(id: app.account.isSignedIn && scenePhase == .active) {
        guard app.account.isSignedIn, scenePhase == .active else { return }
        while !Task.isCancelled {
          await app.account.refreshRequests()
          try? await Task.sleep(for: Self.interval)
        }
      }
      .onChange(of: app.account.requests.map(\.requestId)) { _, _ in
        guard asking == nil, reviewing == nil,
          let next = app.account.requests.first(where: { !seen.contains($0.requestId) })
        else { return }
        seen.insert(next.requestId)
        asking = next
      }
      .alert(
        "\(asking?.subject?.member?.name ?? "A device") wants to join your account",
        isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
        presenting: asking
      ) { request in
        Button("Not now", role: .cancel) {}
        Button("Review") { reviewing = request }
      } message: { _ in
        Text("You'll compare a 6-digit code on both screens. Didn't just sign in on it? Choose Not now and deny it in Settings → Account.")
      }
      .sheet(item: $reviewing) { request in
        ApproveJoinView(request: request).environment(app)
      }
  }
}
