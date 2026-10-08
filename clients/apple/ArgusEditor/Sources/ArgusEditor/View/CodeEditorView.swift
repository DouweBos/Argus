import AppKit
import ArgusUI
import SwiftUI

/// The editor: find bar on top, then gutter and text.
public struct CodeEditorView: View {
  let document: EditorDocument

  public init(document: EditorDocument) {
    self.document = document
  }

  public var body: some View {
    VStack(spacing: 0) {
      if document.find.isVisible {
        FindBarView(model: document.find)
        Divider()
      }
      EditorHost(document: document)
    }
  }
}

/// Puts the document's AppKit stack into SwiftUI and keeps its theme current.
struct EditorHost: NSViewRepresentable {
  let document: EditorDocument
  @Environment(\.theme) private var theme

  func makeNSView(context: Context) -> EditorContainerView {
    let view = EditorContainerView()
    view.attach(document)
    return view
  }

  func updateNSView(_ view: EditorContainerView, context: Context) {
    view.attach(document)
    if document.engine.theme.base != theme {
      document.engine.apply(EditorTheme(theme))
      document.highlighter.themeChanged()
      view.gutter.needsDisplay = true
    }
  }

  static func dismantleNSView(_ view: EditorContainerView, coordinator: ()) {
    view.detach()
  }
}
