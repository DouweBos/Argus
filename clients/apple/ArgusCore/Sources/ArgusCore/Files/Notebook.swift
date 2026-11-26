import Foundation

/// A Jupyter notebook (`.ipynb`) as a reader sees it: its cells and the outputs saved with them.
public struct Notebook: Equatable, Sendable {
  public enum Cell: Equatable, Sendable {
    case markdown(String)
    case code(source: String, executionCount: Int?, outputs: [Output])
    case raw(String)
  }

  public enum Output: Equatable, Sendable {
    /// `stream` text, or a result's `text/plain`; `isError` for stderr.
    case text(String, isError: Bool)
    /// An exception: its name, message and traceback, terminal colours stripped.
    case error(name: String, value: String, traceback: String)
    case image(Data)
    /// `text/html` from a result, with the `text/plain` beside it: viewers show the plain text when
    /// there is one (a table's text form), else the HTML's source, never rendering it unsandboxed.
    case html(String, plain: String?)
    case markdown(String)
  }

  /// The kernel's language, for highlighting code cells; `python` when the file doesn't say.
  public let language: String
  public let cells: [Cell]

  public init(language: String, cells: [Cell]) {
    self.language = language
    self.cells = cells
  }

  public enum ParseError: Error, Equatable {
    case notJSON
    case noCells
  }

  public static func parse(_ data: Data) throws -> Notebook {
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ParseError.notJSON }
    guard let rawCells = root["cells"] as? [[String: Any]] else { throw ParseError.noCells }
    let metadata = root["metadata"] as? [String: Any]
    let language =
      ((metadata?["language_info"] as? [String: Any])?["name"] as? String)
      ?? ((metadata?["kernelspec"] as? [String: Any])?["language"] as? String) ?? "python"
    let cells = rawCells.map { cell -> Cell in
      let source = text(cell["source"])
      switch cell["cell_type"] as? String {
      case "markdown": return .markdown(source)
      case "code":
        let outputs = (cell["outputs"] as? [[String: Any]] ?? []).compactMap(output)
        return .code(source: source, executionCount: cell["execution_count"] as? Int, outputs: outputs)
      default: return .raw(source)
      }
    }
    return Notebook(language: language.lowercased(), cells: cells)
  }

  /// Notebook text is a string or a list of lines.
  static func text(_ value: Any?) -> String {
    if let string = value as? String { return string }
    if let lines = value as? [String] { return lines.joined() }
    return ""
  }

  static func output(_ raw: [String: Any]) -> Output? {
    switch raw["output_type"] as? String {
    case "stream":
      return .text(text(raw["text"]), isError: raw["name"] as? String == "stderr")
    case "error":
      let traceback = (raw["traceback"] as? [String] ?? []).map(stripANSI).joined(separator: "\n")
      return .error(
        name: raw["ename"] as? String ?? "Error", value: raw["evalue"] as? String ?? "", traceback: traceback)
    case "execute_result", "display_data":
      let bundle = raw["data"] as? [String: Any] ?? [:]
      for type in ["image/png", "image/jpeg"] {
        if let base64 = bundle[type] as? String,
          let data = Data(base64Encoded: base64.filter { !$0.isWhitespace })
        {
          return .image(data)
        }
      }
      if let html = bundle["text/html"] { return .html(text(html), plain: bundle["text/plain"].map(text)) }
      if let markdown = bundle["text/markdown"] { return .markdown(text(markdown)) }
      if let plain = bundle["text/plain"] { return .text(text(plain), isError: false) }
      return nil
    default:
      return nil
    }
  }

  /// Tracebacks carry terminal colour codes.
  public static func stripANSI(_ text: String) -> String {
    text.replacing(/\u{1B}\[[0-9;]*[A-Za-z]/, with: "")
  }
}
