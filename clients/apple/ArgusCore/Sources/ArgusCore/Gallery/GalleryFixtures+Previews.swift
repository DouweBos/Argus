import CoreGraphics
import CoreText
import Foundation

/// Rendered previews on both apps: a README, diagrams good and broken, a PDF.
extension GalleryFixtures {
  public static let previewReadme = """
    # quick-open-polish

    ![CI](docs/badge-ci.svg) ![Coverage](docs/badge-coverage.svg)

    Fuzzy file search for the code view, ranked by **path segments** and recency. See \
    [the design notes](docs/quick-open.md) or jump to [the matcher](src/lib/fuzzyMatch.ts#L12).

    ## Status

    | Area | Owner | State | Notes |
    |---|---|---|---|
    | Matcher | Agent 1 | Done | Scores runs of consecutive characters higher |
    | Ranking | Agent 2 | In review | Recency decays over 7 days |
    | Mac UI | Agent 3 | Done | ⌘P opens it over the editor |
    | Phone UI | — | Not started | Waits on the gateway method |

    ## Checklist

    - [x] Match on path segments
    - [x] Highlight matched characters
    - [ ] Remember the last query per session
    - [ ] Ship it

    ## How a query flows

    ```mermaid
    sequenceDiagram
      participant U as You
      participant Q as Quick Open
      participant H as Host
      U->>Q: types "qopen"
      Q->>H: list_session_files
      H-->>Q: 2,481 paths
      Q->>Q: score and rank
      Q-->>U: top 50, matches highlighted
    ```

    ## Usage

    ```ts
    import { fuzzyMatch } from "./lib/fuzzyMatch";

    const hits = fuzzyMatch(files, "qopen").slice(0, 50);
    ```

    > Ranking is stable: equal scores keep the file list's order.
    """

  /// A landing page whose stylesheet comes from the worktree and whose web font is blocked.
  public static let previewHTML = """
    <!doctype html>
    <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Quick Open</title>
    <link rel="stylesheet" href="styles.css">
    <link rel="stylesheet" href="https://fonts.example.com/inter.css">
    </head><body>
    <header><h1>Quick Open</h1><p>Any file in the worktree, two keystrokes away.</p></header>
    <main>
      <section class="card"><h2>Fuzzy</h2><p>Characters in order, runs score higher.</p></section>
      <section class="card"><h2>Recent</h2><p>Files you opened lately rank first.</p></section>
      <section class="card"><h2>Everywhere</h2><p>On the Mac, the iPhone and Android.</p></section>
    </main>
    <p id="script">Scripts didn't run.</p>
    <script>document.getElementById("script").textContent = "Scripts run; the network stays off."</script>
    </body></html>
    """

  static let previewStyles = """
    body { font: 15px -apple-system, sans-serif; margin: 0; background: #f6f7fb; color: #1d2433; }
    header { background: linear-gradient(120deg, #1f6feb, #8957e5); color: white; padding: 32px 24px; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; padding: 20px 24px; }
    .card { background: white; border-radius: 10px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
    .card h2 { font-size: 16px; margin: 0 0 4px; }
    #script { padding: 0 24px; color: #57606a; }
    """

  public static let previewFlowchart = """
    flowchart LR
      A[Agent edits] --> B{Tests pass?}
      B -- yes --> C[Open pull request]
      B -- no --> D[Read the failure]
      D --> A
      C --> E((Merged))
    """

  public static let previewSequence = """
    sequenceDiagram
      participant P as iPhone
      participant H as Host
      participant W as Worktree
      P->>H: files.read_bytes(spec.pdf)
      H->>W: read, confined to the session
      W-->>H: 1.2 MB
      H-->>P: base64
      Note over P: PDFKit draws page 1
    """

  /// Missing an arrow's target: Mermaid refuses it, and the source shows with the error.
  public static let previewBroken = """
    flowchart TD
      A[Start] -->
      B[Never connected
    """

  /// A transcript reply that draws two diagrams and fumbles a third.
  public static let previewTranscript = """
    Here's how the merge queue works now:

    ```mermaid
    \(previewFlowchart)
    ```

    And the phone's file read, end to end:

    ```mermaid
    \(previewSequence)
    ```

    I also tried sketching the retry loop, but got the syntax wrong:

    ```mermaid
    \(previewBroken)
    ```
    """

  /// A badge, as READMEs embed them: an SVG the preview draws through the diagram renderer.
  public static func previewBadge(_ label: String, _ value: String, color: String) -> Data {
    let width = 7 * (label.count + value.count) + 24
    let split = 7 * label.count + 12
    return Data(
      """
      <svg xmlns="http://www.w3.org/2000/svg" width="\(width)" height="20">
      <rect width="\(split)" height="20" fill="#555"/><rect x="\(split)" width="\(width - split)" height="20" fill="\(color)"/>
      <g fill="#fff" font-family="Verdana,sans-serif" font-size="11">
      <text x="6" y="14">\(label)</text><text x="\(split + 6)" y="14">\(value)</text></g></svg>
      """.utf8)
  }

  /// The README's relative images.
  public static func previewFile(_ path: String) -> Data? {
    switch path {
    case "docs/badge-ci.svg": previewBadge("ci", "passing", color: "#2ea043")
    case "docs/badge-coverage.svg": previewBadge("coverage", "94%", color: "#1f6feb")
    case "site/styles.css": Data(previewStyles.utf8)
    default: nil
    }
  }

  /// A three-page design spec, drawn here so no binary fixture is checked in.
  public static func previewPDF() -> Data {
    let data = NSMutableData()
    var box = CGRect(x: 0, y: 0, width: 612, height: 792)
    guard let consumer = CGDataConsumer(data: data as CFMutableData),
      let context = CGContext(consumer: consumer, mediaBox: &box, nil)
    else { return Data() }
    let pages = [
      ("Quick Open — design spec", "1. Goals\n\nOpen any file in the worktree in two keystrokes. Rank by path segments, then recency."),
      ("2. Matching", "Characters must appear in order. Runs of consecutive characters score higher; a match at a segment start scores highest."),
      ("3. Rollout", "Mac first, behind ⌘P. The phones follow once files.read lands on the gateway."),
    ]
    for (index, page) in pages.enumerated() {
      context.beginPDFPage(nil)
      context.setFillColor(CGColor(red: 0.12, green: 0.44, blue: 0.92, alpha: 1))
      context.fill(CGRect(x: 0, y: 742, width: 612, height: 50))
      draw(page.0, in: CGRect(x: 54, y: 650, width: 504, height: 70), size: 24, bold: true, context: context)
      draw(page.1, in: CGRect(x: 54, y: 300, width: 504, height: 330), size: 14, bold: false, context: context)
      draw("Page \(index + 1) of \(pages.count)", in: CGRect(x: 54, y: 30, width: 504, height: 20), size: 10, bold: false, context: context)
      context.endPDFPage()
    }
    context.closePDF()
    return data as Data
  }

  private static func draw(_ text: String, in rect: CGRect, size: CGFloat, bold: Bool, context: CGContext) {
    let font = CTFontCreateUIFontForLanguage(bold ? .emphasizedSystem : .system, size, nil)
    let attributes: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): font as Any,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0.1, alpha: 1),
    ]
    let string = NSAttributedString(string: text, attributes: attributes)
    let frame = CTFramesetterCreateFrame(
      CTFramesetterCreateWithAttributedString(string), CFRange(), CGPath(rect: rect, transform: nil), nil)
    CTFrameDraw(frame, context)
  }
}
