import Foundation
import Testing

@testable import ArgusCore

@Suite("Notebooks")
struct NotebookTests {
  private func parse(_ json: String) throws -> Notebook { try Notebook.parse(Data(json.utf8)) }

  @Test func cellsAndTheirSources() throws {
    let notebook = try parse(
      """
      {"metadata": {"kernelspec": {"language": "Python"}},
       "cells": [
        {"cell_type": "markdown", "source": ["# Title\\n", "Some text"]},
        {"cell_type": "code", "execution_count": 3, "source": "print(1)", "outputs": []},
        {"cell_type": "raw", "source": "raw"}
       ]}
      """)
    #expect(notebook.language == "python")
    #expect(
      notebook.cells == [
        .markdown("# Title\nSome text"),
        .code(source: "print(1)", executionCount: 3, outputs: []),
        .raw("raw"),
      ])
  }

  @Test func savedOutputs() throws {
    let png = Data([0x89, 0x50, 0x4E, 0x47]).base64EncodedString()
    let notebook = try parse(
      """
      {"metadata": {"language_info": {"name": "julia"}},
       "cells": [{"cell_type": "code", "execution_count": null, "source": "x", "outputs": [
        {"output_type": "stream", "name": "stdout", "text": ["a\\n", "b"]},
        {"output_type": "stream", "name": "stderr", "text": "warn"},
        {"output_type": "execute_result", "data": {"text/plain": "42", "text/html": "<b>42</b>"}},
        {"output_type": "display_data", "data": {"image/png": "\(png)\\n", "text/plain": "<Figure>"}},
        {"output_type": "error", "ename": "ValueError", "evalue": "bad", "traceback": ["\\u001b[31mValueError\\u001b[0m: bad"]},
        {"output_type": "unknown"}
       ]}]}
      """)
    #expect(notebook.language == "julia")
    guard case .code(_, let count, let outputs) = notebook.cells.first else {
      Issue.record("expected a code cell")
      return
    }
    #expect(count == nil)
    #expect(
      outputs == [
        .text("a\nb", isError: false),
        .text("warn", isError: true),
        .html("<b>42</b>", plain: "42"),
        .image(Data([0x89, 0x50, 0x4E, 0x47])),
        .error(name: "ValueError", value: "bad", traceback: "ValueError: bad"),
      ])
  }

  @Test func refusesWhatIsNotANotebook() {
    #expect(throws: Notebook.ParseError.notJSON) { try parse("nope") }
    #expect(throws: Notebook.ParseError.noCells) { try parse("{}") }
  }
}
