import AppKit
import ArgusCore
import SwiftUI

/// While the window is open and signed in: a device waiting to join the
/// account is announced in the main window, and Review compares the code.
struct AccountJoinPrompt: ViewModifier {
  @Environment(AccountStore.self) private var account
  @Environment(\.controlActiveState) private var activeState
  @State private var asking: AccountJoinRequestInfo?
  @State private var reviewing: AccountJoinRequestInfo?
  @State private var seen: Set<String> = []

  /// A request lives 10 minutes; checking every 30 s while open catches it.
  private static let interval: Duration = .seconds(30)

  func body(content: Content) -> some View {
    content
      .task(id: account.isSignedIn && activeState != .inactive) {
        guard account.isSignedIn, activeState != .inactive else { return }
        while !Task.isCancelled {
          await account.refreshRequests()
          try? await Task.sleep(for: Self.interval)
        }
      }
      .onChange(of: account.requests.map(\.requestId)) { _, _ in
        guard asking == nil, reviewing == nil,
          let next = account.requests.first(where: { !seen.contains($0.requestId) })
        else { return }
        seen.insert(next.requestId)
        asking = next
      }
      .alert(
        "\(asking?.subject?.member?.name ?? "A device") wants to join your account",
        isPresented: Binding(get: { asking != nil }, set: { if !$0 { asking = nil } }),
        presenting: asking
      ) { request in
        Button("Review…") { reviewing = request }
        Button("Not Now", role: .cancel) {}
      } message: { _ in
        Text("You'll compare a 6-digit code on both screens. Didn't just sign in on it? Choose Not Now and deny it in Settings → Account.")
      }
      .sheet(item: $reviewing) { request in
        AccountApprovalPanel(request: request)
      }
  }
}
