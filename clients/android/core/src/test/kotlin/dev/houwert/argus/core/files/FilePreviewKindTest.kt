package dev.houwert.argus.core.files

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class FilePreviewKindTest {
  @Test fun kindsFollowTheExtension() {
    assertEquals(FilePreviewKind.Markdown, FilePreviewKind.of("README.md"))
    assertEquals(FilePreviewKind.Markdown, FilePreviewKind.of("docs/page.MDX"))
    assertEquals(FilePreviewKind.Pdf, FilePreviewKind.of("spec.pdf"))
    for (image in listOf("a.png", "a.JPG", "a.gif", "a.webp", "icons/a.svg")) {
      assertEquals(FilePreviewKind.Image, FilePreviewKind.of(image), image)
    }
    assertEquals(FilePreviewKind.Html, FilePreviewKind.of("site/index.HTML"))
    assertEquals(FilePreviewKind.Html, FilePreviewKind.of("a.htm"))
    assertEquals(FilePreviewKind.Notebook, FilePreviewKind.of("analysis/Explore.ipynb"))
    for (document in listOf("spec.docx", "Plan.XLSX", "deck.pptx", "talk.key", "notes.pages", "budget.numbers")) {
      assertEquals(FilePreviewKind.Office, FilePreviewKind.of(document), document)
    }
    assertNull(FilePreviewKind.of("Main.kt"))
    assertNull(FilePreviewKind.of("Makefile"))
    assertNull(FilePreviewKind.of(".md"))
  }

  @Test fun relativeLinksResolveAgainstTheDocument() {
    assertEquals(MarkdownTarget.File("docs/guide.md"), MarkdownTarget.resolve("guide.md", "docs/README.md"))
    assertEquals(MarkdownTarget.File("src/a.ts", 12), MarkdownTarget.resolve("../src/a.ts#L12", "docs/README.md"))
    assertEquals(MarkdownTarget.File("img/shot 1.png"), MarkdownTarget.resolve("./img/shot%201.png", "README.md"))
    assertEquals(MarkdownTarget.File("docs/a.md"), MarkdownTarget.resolve("/docs/a.md", "pkg/README.md"))
    assertNull(MarkdownTarget.resolve("../../etc/passwd", "README.md"))
    assertNull(MarkdownTarget.resolve("..", "README.md"))
  }

  @Test fun anchorsAndWebLinks() {
    assertEquals(MarkdownTarget.Anchor("getting-started"), MarkdownTarget.resolve("#getting-started", "README.md"))
    assertEquals(MarkdownTarget.External("https://example.com"), MarkdownTarget.resolve("https://example.com", "README.md"))
    assertNull(MarkdownTarget.resolve("javascript:alert(1)", "README.md"))
    assertNull(MarkdownTarget.resolve("file:///etc/passwd", "README.md"))
    assertEquals("getting-started-fast", MarkdownTarget.anchor("Getting `Started` (fast)!"))
  }

  @Test fun imageOnlyParagraphs() {
    assertEquals(
      listOf(MarkdownImageLine.Image("CI", "https://x.dev/ci.svg"), MarkdownImageLine.Image("", "img/a.png")),
      MarkdownImageLine.images("![CI](https://x.dev/ci.svg) ![](img/a.png \"Shot\")"),
    )
    assertNull(MarkdownImageLine.images("See ![shot](a.png) here"))
    assertNull(MarkdownImageLine.images("No images"))
  }

  @Test fun taskItems() {
    assertEquals(MarkdownTask.Item(false, "Write it"), MarkdownTask.split("[ ] Write it"))
    assertEquals(MarkdownTask.Item(true, "Ship it"), MarkdownTask.split("[X] Ship it"))
    assertNull(MarkdownTask.split("[link](x) item"))
  }
}
