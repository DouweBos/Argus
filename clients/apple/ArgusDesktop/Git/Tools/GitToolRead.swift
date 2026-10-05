import ArgusUI
import SwiftUI

/// A host read for a tool view. Reads skip `workspace.host`: it refreshes the
/// panel, and a read keyed on that refresh would loop.
@MainActor
enum GitToolRead {
  static func request<C: RemoteCommand>(
    _ store: HostStore, _ command: sending C.Type, _ params: C.Params
  ) async -> Result<C.Result, ToolError> {
    guard let backend = store.backend else { return .failure(ToolError(message: "Not connected to the host.")) }
    do {
      return .success(try await backend.request(command, params))
    } catch {
      return .failure(ToolError(message: HostStore.describe(error)))
    }
  }

  struct ToolError: Error {
    let message: String
  }
}

/// A tool view's own header: what it is, why it's there, and its actions.
struct GitToolHeader<Actions: View>: View {
  let title: String
  var caption: String?
  @ViewBuilder var actions: Actions

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.scaled(.headline))
        if let caption {
          Text(caption).font(.scaled(.callout)).foregroundStyle(.secondary)
        }
      }
      Spacer()
      actions
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }
}

extension GitToolHeader where Actions == EmptyView {
  init(title: String, caption: String? = nil) {
    self.init(title: title, caption: caption) { EmptyView() }
  }
}
