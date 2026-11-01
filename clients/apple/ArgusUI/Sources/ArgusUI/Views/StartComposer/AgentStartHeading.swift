import SwiftUI

/// The line over a start composer: "What should we build in <project>?", or
/// "What should we work on?" with no project. Each platform supplies the project
/// name's own view (a picker on the Mac).
public struct AgentStartHeading<Project: View>: View {
  @Environment(\.theme) private var theme
  private let project: Project?

  public init(@ViewBuilder project: () -> Project) {
    self.project = project()
  }

  public var body: some View {
    Group {
      if let project {
        // Too narrow for one line (a phone, a long name), the project goes on its own.
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text("What should we build in ")
            project
            Text("?")
          }
          VStack(spacing: 2) {
            Text("What should we build in")
            HStack(alignment: .firstTextBaseline, spacing: 0) {
              project
              Text("?")
            }
          }
        }
      } else {
        Text("What should we work on?")
      }
    }
    .font(.scaled(size: Self.size, weight: .medium))
    .foregroundStyle(theme.text)
    .lineLimit(1)
    .multilineTextAlignment(.center)
  }

  #if os(macOS)
    private static var size: CGFloat { 26 }
  #else
    private static var size: CGFloat { 22 }
  #endif
}

extension AgentStartHeading where Project == EmptyView {
  public init() {
    project = nil
  }
}
