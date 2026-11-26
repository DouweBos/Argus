import ArgusCore
import SwiftUI

/// A Jupyter notebook as its author saw it: Markdown cells rendered, code cells highlighted,
/// and the outputs saved with them.
public struct NotebookView: View {
  @Environment(\.theme) private var theme
  let text: String
  let document: MarkdownDocument
  @State private var parsed: Notebook?
  @State private var failed = false

  public init(text: String, document: MarkdownDocument) {
    self.text = text
    self.document = document
  }

  public var body: some View {
    Group {
      if let notebook = parsed {
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(Array(notebook.cells.enumerated()), id: \.offset) { _, cell in
              NotebookCellView(cell: cell, language: notebook.language)
            }
          }
          .textSelection(.enabled)
          .frame(maxWidth: 900, alignment: .leading)
          .padding(.horizontal, 20)
          .padding(.vertical, 18)
          .frame(maxWidth: .infinity)
          .environment(\.markdownDocument, document)
        }
      } else if failed {
        EmptyState(
          icon: "doc.questionmark", title: "Can't read this notebook",
          body: "It isn't a notebook file Argus can parse. Its source is still there to read.")
      } else {
        ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .background(theme.bg)
    .task(id: text) {
      let text = text
      let notebook = await Task.detached { try? Notebook.parse(Data(text.utf8)) }.value
      parsed = notebook
      failed = notebook == nil
    }
  }
}

private struct NotebookCellView: View {
  @Environment(\.theme) private var theme
  let cell: Notebook.Cell
  let language: String

  var body: some View {
    switch cell {
    case .markdown(let text):
      MarkdownView(text: text)
    case .raw(let text):
      monospaced(text, color: theme.textSecondary)
    case .code(let source, let count, let outputs):
      VStack(alignment: .leading, spacing: 6) {
        Text(count.map { "In [\($0)]" } ?? "In [ ]")
          .font(.scaled(size: 11, weight: .medium, design: .monospaced))
          .foregroundStyle(theme.textMuted)
        CodeBlockView(language: language, code: source)
        ForEach(Array(outputs.enumerated()), id: \.offset) { _, output in
          NotebookOutputView(output: output)
        }
      }
    }
  }

  private func monospaced(_ text: String, color: Color) -> some View {
    Text(verbatim: text)
      .font(.scaled(size: 12, design: .monospaced))
      .foregroundStyle(color)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct NotebookOutputView: View {
  @Environment(\.theme) private var theme
  let output: Notebook.Output

  var body: some View {
    switch output {
    case .text(let text, let isError):
      block(text, color: isError ? theme.error : theme.text, background: isError ? theme.errorSoft : Color.clear)
    case .error(let name, let value, let traceback):
      VStack(alignment: .leading, spacing: 4) {
        Text(value.isEmpty ? name : "\(name): \(value)")
          .font(.scaled(size: 12, weight: .semibold, design: .monospaced))
          .foregroundStyle(theme.error)
        if !traceback.isEmpty {
          ScrollView(.horizontal, showsIndicators: false) {
            Text(verbatim: traceback)
              .font(.scaled(size: 11, design: .monospaced))
              .foregroundStyle(theme.textSecondary)
              .fixedSize(horizontal: true, vertical: false)
          }
        }
      }
      .padding(8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(theme.errorSoft)
      .clipShape(RoundedRectangle(cornerRadius: theme.radiusSmall))
    case .image(let data):
      if let image = PlatformImage(data: data) {
        Image(platformImage: image)
          .resizable()
          .scaledToFit()
          .frame(maxWidth: min(image.size.width, 720), maxHeight: 480, alignment: .leading)
          .accessibilityLabel("Cell output image")
      }
    case .html(let html, let plain):
      VStack(alignment: .leading, spacing: 2) {
        if plain == nil {
          Text("HTML output, shown as source")
            .font(.scaled(size: 10, weight: .semibold))
            .foregroundStyle(theme.textMuted)
        }
        block(plain ?? html, color: theme.text, background: Color.clear)
      }
    case .markdown(let text):
      MarkdownView(text: text)
    }
  }

  private func block(_ text: String, color: Color, background: Color) -> some View {
    ScrollView(.horizontal, showsIndicators: false) {
      Text(verbatim: text.hasSuffix("\n") ? String(text.dropLast()) : text)
        .font(.scaled(size: 12, design: .monospaced))
        .foregroundStyle(color)
        .fixedSize(horizontal: true, vertical: false)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(background)
    .overlay(alignment: .leading) { Rectangle().fill(theme.border).frame(width: 2) }
  }
}
