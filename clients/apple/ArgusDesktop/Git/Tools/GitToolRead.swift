import ArgusUI
import GroveUIKit
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

/// A tool view as Grove's repository settings: one card with GroveUIKit's panel header, what the view is for, and
/// its actions; `maxWidth` keeps a form from stretching across a wide window.
struct GitToolPanel<Actions: View, Content: View>: View {
  @Environment(\.theme) private var theme
  let title: String
  var detail: String?
  var caption: String?
  var maxWidth: CGFloat?
  @ViewBuilder var actions: Actions
  @ViewBuilder var content: Content

  var body: some View {
    VStack(spacing: 0) {
      GitPanelHeader(title: title, detail: detail) { actions }
        .controlSize(.small)
      if let caption {
        Text(caption)
          .font(.scaled(size: 12))
          .foregroundStyle(theme.textMuted)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.horizontal, 16)
          .padding(.vertical, 8)
          .overlay(alignment: .bottom) { Rectangle().fill(theme.border).frame(height: 0.5) }
      }
      content.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .frame(maxWidth: maxWidth ?? .infinity, maxHeight: .infinity, alignment: .top)
    .gitPanel()
    .frame(maxWidth: .infinity)
    .gitPanelPadding()
  }
}

extension GitToolPanel where Actions == EmptyView {
  init(title: String, detail: String? = nil, caption: String? = nil, maxWidth: CGFloat? = nil, @ViewBuilder content: () -> Content) {
    self.init(title: title, detail: detail, caption: caption, maxWidth: maxWidth, actions: { EmptyView() }, content: content)
  }
}

/// Argus's toned badges as GroveUIKit's, with a symbol for each tone.
struct GitToneBadge: View {
  let label: String
  let tone: Tone
  var symbol: String?

  var body: some View {
    GitStatusBadge(title: label, symbol: symbol ?? defaultSymbol, tone: kitTone)
  }

  private var kitTone: GitStatusBadge.Tone {
    switch tone {
    case .success, .accent: .positive
    case .warning: .caution
    case .danger: .negative
    case .muted: .neutral
    }
  }

  private var defaultSymbol: String {
    switch tone {
    case .success, .accent: "checkmark.circle.fill"
    case .warning: "exclamationmark.triangle.fill"
    case .danger: "xmark.octagon.fill"
    case .muted: "circle"
    }
  }
}
