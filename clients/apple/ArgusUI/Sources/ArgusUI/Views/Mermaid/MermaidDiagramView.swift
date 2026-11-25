import SwiftUI

/// A ```mermaid fence, drawn. Pinch or the buttons zoom it, a drag pans it,
/// Expand opens it full size, and Copy Source copies what the agent wrote.
/// Source Mermaid can't draw shows as a code block with Mermaid's error —
/// never an empty box.
public struct MermaidDiagramView: View {
  @Environment(\.theme) private var theme
  let source: String
  /// The tallest it draws inline; a taller diagram is scaled down to fit.
  var maxHeight: CGFloat

  @State private var outcome: MermaidRenderer.Outcome?
  @State private var expanded = false
  @State private var copied = false

  /// The zoom strip under the picture.
  static let controlsHeight: CGFloat = 40

  public init(source: String, maxHeight: CGFloat = 420) {
    self.source = source
    self.maxHeight = maxHeight
  }

  /// Starts on an outcome already rendered, so a sizing pass measures what will show.
  public init(source: String, outcome: MermaidRenderer.Outcome?, maxHeight: CGFloat = 420) {
    self.init(source: source, maxHeight: maxHeight)
    _outcome = State(initialValue: outcome)
  }

  public var body: some View {
    Group {
      switch outcome {
      case .rendered(let diagram):
        rendered(diagram)
      case .invalid(let message):
        failed(message)
      case nil:
        frame(header: header(expandable: false)) {
          ProgressView().controlSize(.small).frame(maxWidth: .infinity).frame(height: 96)
        }
      }
    }
    .task(id: RenderKey(source: source, palette: MermaidPalette(theme: theme))) {
      let palette = MermaidPalette(theme: theme)
      if let cached = MermaidRenderer.shared.cached(source, palette: palette) {
        outcome = cached
        return
      }
      // Keeps the old picture while the other scheme's renders, rather than flashing a spinner.
      let next = await MermaidRenderer.shared.render(source, palette: palette)
      guard !Task.isCancelled else { return }
      outcome = next
    }
  }

  private func rendered(_ diagram: MermaidRenderer.Diagram) -> some View {
    frame(header: header(expandable: true)) {
      // Never past its own size: a small diagram isn't blown up to the column's width.
      DiagramHeight(size: diagram.size, maxHeight: maxHeight, extra: Self.controlsHeight) {
        ZoomPanImage(data: diagram.png, label: "Diagram", controlsBelow: true)
      }
      .padding(.top, 4)
    }
    .sheet(isPresented: $expanded) {
      MermaidExpandedView(png: diagram.png, source: source)
    }
  }

  private func failed(_ message: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Label("Mermaid couldn't draw this diagram: \(message)", systemImage: "exclamationmark.triangle")
        .font(.scaled(size: 12))
        .foregroundStyle(theme.error)
        .textSelection(.enabled)
      CodeBlockView(language: "mermaid", code: source)
    }
  }

  private func header(expandable: Bool) -> some View {
    HStack(spacing: 2) {
      Text("mermaid")
        .font(.scaled(size: 10, weight: .semibold))
        .foregroundStyle(theme.textMuted)
      Spacer()
      if expandable {
        IconBtn(systemName: Icon.expand, label: "Expand", size: 12) { expanded = true }
      }
      IconBtn(systemName: copied ? Icon.check : Icon.copy, label: "Copy Source", size: 12) {
        Clipboard.copy(source)
        copied = true
        Task {
          try? await Task.sleep(for: .seconds(1.5))
          copied = false
        }
      }
    }
    .padding(.leading, 8)
    .padding(.trailing, 2)
    .frame(height: 28)
  }

  private func frame(header: some View, @ViewBuilder content: () -> some View) -> some View {
    VStack(spacing: 0) {
      header
      content()
    }
    .frame(maxWidth: .infinity)
    .background(theme.bgSecondary)
    .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    .overlay(RoundedRectangle(cornerRadius: theme.radiusSmall).strokeBorder(theme.border))
  }

  private struct RenderKey: Equatable {
    let source: String
    let palette: MermaidPalette
  }
}

/// As tall as the diagram at the width it's offered, never past its own size or `maxHeight`.
private struct DiagramHeight: SwiftUI.Layout {
  let size: CGSize
  let maxHeight: CGFloat
  let extra: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? size.width
    let scale = size.width > 0 ? min(1, width / size.width) : 1
    return CGSize(width: width, height: min(maxHeight, size.height * scale) + extra)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
  }
}

/// The diagram filling a sheet, for detail too small inline.
struct MermaidExpandedView: View {
  @Environment(\.theme) private var theme
  @Environment(\.dismiss) private var dismiss
  let png: Data
  let source: String

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 2) {
        Text("Diagram").font(.scaled(size: 13, weight: .semibold)).foregroundStyle(theme.text)
        Spacer()
        IconBtn(systemName: Icon.copy, label: "Copy Source", size: 14) { Clipboard.copy(source) }
        IconBtn(systemName: Icon.close, label: "Close", size: 14) { dismiss() }
          .keyboardShortcut(.cancelAction)
      }
      .padding(.horizontal, 12)
      .frame(height: 44)
      Rectangle().fill(theme.border).frame(height: 1)
      ZoomPanImage(data: png, label: "Diagram")
    }
    .background(theme.bg)
    #if os(macOS)
      .frame(minWidth: 720, idealWidth: 960, minHeight: 520, idealHeight: 720)
    #endif
  }
}

#Preview("Mermaid: flowchart, sequence, broken") {
  ScrollView {
    VStack(spacing: 16) {
      MermaidDiagramView(source: "flowchart LR\n  A[Agent] --> B{Tests pass?}\n  B -- yes --> C[Merge]\n  B -- no --> A")
      MermaidDiagramView(source: "sequenceDiagram\n  Phone->>Host: files.read_bytes\n  Host-->>Phone: base64")
      MermaidDiagramView(source: "flowchart LR\n  A -->")
    }
    .padding()
  }
  .frame(width: 520, height: 700)
}
