import AppKit
import ArgusCore
import ArgusEditor
import ArgusUI
import PDFKit
import SwiftUI

/// A Markdown or HTML tab: its text, the rendered page following the text as
/// it's typed, or both side by side.
struct CodeMarkdownContent: View {
  @Environment(\.theme) private var theme
  let code: CodeSession
  @Bindable var file: CodeFile
  let document: EditorDocument
  let editor: AnyView

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        if file.preview == .html, file.markdownMode != .source {
          Toggle("Allow Network", isOn: $file.allowsNetwork)
            .toggleStyle(.checkbox)
            .controlSize(.small)
            .clickable()
            .help("Let this page load from the web. Off, it only reaches files in the worktree.")
        }
        Spacer()
        Picker("View", selection: $file.markdownMode) {
          ForEach(MarkdownViewMode.allCases, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .controlSize(.small)
        .fixedSize()
        .help("Show the source, the rendered page, or both")
      }
      .padding(.horizontal, 10)
      .frame(height: 30)
      Rectangle().fill(theme.border).frame(height: 1)
      switch file.markdownMode {
      case .source:
        editor
      case .preview:
        preview
      case .split:
        ResizableHSplit(key: "code.markdownSplit", leadingMin: 240, leadingIdeal: 520, leadingMax: 1400, trailingMin: 240) {
          editor
        } trailing: {
          preview
        }
      }
    }
    .onChange(of: file.markdownMode, initial: true) { _, mode in
      guard mode != .source, !file.reportedPreview else { return }
      file.reportedPreview = true
      MacTelemetry.capture(.previewOpened(kind: file.preview ?? .markdown))
    }
  }

  @ViewBuilder private var preview: some View {
    if file.preview == .notebook {
      CodeNotebookPreview(document: document, context: code.markdownDocument(for: file.path))
    } else if file.preview == .html {
      CodeHTMLPreview(document: document, context: code.markdownDocument(for: file.path), allowNetwork: file.allowsNetwork)
    } else {
      CodeMarkdownPreview(document: document, context: code.markdownDocument(for: file.path))
    }
  }
}

/// The page, re-rendered a beat after typing stops rather than on every key.
private struct CodeMarkdownPreview: View {
  let document: EditorDocument
  let context: MarkdownDocument
  @State private var text = ""

  var body: some View {
    MarkdownPreview(text: text, document: context)
      .task(id: document.version) {
        if !text.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
        guard !Task.isCancelled else { return }
        text = document.text
      }
  }
}

/// The notebook re-parsed a beat after typing stops.
private struct CodeNotebookPreview: View {
  let document: EditorDocument
  let context: MarkdownDocument
  @State private var text: String?

  var body: some View {
    Group {
      if let text { NotebookView(text: text, document: context) } else { Color.clear }
    }
    .task(id: document.version) {
      if text != nil { try? await Task.sleep(for: .milliseconds(400)) }
      guard !Task.isCancelled else { return }
      text = document.text
    }
  }
}

/// The page in a sandboxed web view, reloaded a beat after typing stops.
private struct CodeHTMLPreview: View {
  let document: EditorDocument
  let context: MarkdownDocument
  let allowNetwork: Bool
  @State private var text: String?

  var body: some View {
    Group {
      if let text { SandboxedHTMLView(html: text, document: context, allowNetwork: allowNetwork) } else { Color.clear }
    }
    .task(id: document.version) {
      if text != nil { try? await Task.sleep(for: .milliseconds(500)) }
      guard !Task.isCancelled else { return }
      text = document.text
    }
  }
}

/// A PDF or an image, in place of the editor.
struct CodeBinaryContent: View {
  let file: CodeFile
  let data: Data
  @State private var pdf: PDFDocument?

  var body: some View {
    Group {
      switch file.preview {
      case .pdf:
        if let pdf {
          PDFDocumentView(document: pdf)
        } else {
          EmptyState(icon: "doc.questionmark", title: "Can't open this PDF", body: "It may be damaged or encrypted.")
        }
      default:
        ImageFilePreview(data: data, path: file.path)
      }
    }
    .onChange(of: data, initial: true) {
      if file.preview == .pdf { pdf = PDFDocument(data: data) }
    }
    .onAppear {
      guard let kind = file.preview, !file.reportedPreview else { return }
      file.reportedPreview = true
      MacTelemetry.capture(.previewOpened(kind: kind))
    }
  }
}

extension CodeSession {
  /// Where a previewed file's relative images and links lead: its worktree, this code view, the browser.
  func markdownDocument(for path: String) -> MarkdownDocument {
    MarkdownDocument(
      path: path,
      loadFile: { [weak self] relative in
        guard let self, let store = self.store,
          let base64 = try? await store.request(
            ArgusProtocol.Commands.ReadFileBytes.self, .init(id: self.sessionId, relativePath: relative),
            session: self.sessionId)
        else { return nil }
        return Data(base64Encoded: base64)
      },
      open: { [weak self] target in
        switch target {
        case .file(let path, let line): self?.navigate(to: path, line: line, source: .markdownLink)
        case .external(let url): NSWorkspace.shared.open(url)
        case .anchor: break
        }
      })
  }
}
