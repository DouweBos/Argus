import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../state", () => ({
  appState: { sessions: new Map<string, { path: string }>() },
}));
vi.mock("../telemetry/telemetry", () => ({ capture: vi.fn() }));

const { appState } = await import("../../state");
const { capture } = await import("../telemetry/telemetry");
const { documentKind, extractDocumentText, stripRtf } =
  await import("./documentText");
const { mentionedPaths, withAttachedDocumentText } =
  await import("./attachedDocuments");

/** A zip with each file deflated, enough for the reader under test. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text);
    const data = zlib.deflateRawSync(raw);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

let dir: string;

async function write(name: string, bytes: Buffer | string): Promise<string> {
  const file = path.join(dir, name);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, bytes);

  return file;
}

describe("documents attached to a message", () => {
  beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "argus-doc-"));
    appState.sessions.clear();
    appState.sessions.set("s1", { path: dir } as never);
    vi.mocked(capture).mockClear();
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  describe("extractDocumentText", () => {
    it("reads a Word document's paragraphs, tabs and entities", async () => {
      const file = await write(
        "spec.docx",
        zip({
          "word/document.xml":
            '<w:document><w:body><w:p w:rsidR="1"/><w:p><w:pPr/><w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B &amp; C</w:t></w:r></w:p></w:body></w:document>',
        }),
      );

      await expect(extractDocumentText(file, "docx")).resolves.toBe(
        "Hello world\nA\tB & C",
      );
    });

    it("reads slides in their numeric order", async () => {
      const slide = (text: string) =>
        `<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
      const file = await write(
        "deck.pptx",
        zip({
          "ppt/slides/slide10.xml": slide("Ten"),
          "ppt/slides/slide2.xml": slide("Two"),
          "ppt/slides/slide1.xml": slide("One"),
        }),
      );

      await expect(extractDocumentText(file, "pptx")).resolves.toBe(
        "Slide 1\nOne\n\nSlide 2\nTwo\n\nSlide 3\nTen",
      );
    });

    it("reads sheets as tab-separated rows, shared strings resolved", async () => {
      const file = await write(
        "data.xlsx",
        zip({
          "xl/workbook.xml":
            '<workbook><sheets><sheet name="Q1 &amp; Q2" sheetId="1" r:id="rId1"/></sheets></workbook>',
          "xl/_rels/workbook.xml.rels":
            '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
          "xl/sharedStrings.xml":
            "<sst><si><t>Name</t></si><si><r><t>Ada</t></r><r><t> L</t></r></si></sst>",
          "xl/worksheets/sheet1.xml":
            '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>42</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>',
        }),
      );

      await expect(extractDocumentText(file, "xlsx")).resolves.toBe(
        "Sheet: Q1 & Q2\nName\t\t42\nAda L\tx",
      );
    });

    it("gives null for a file that isn't the zip it claims to be", async () => {
      const file = await write("fake.docx", "not a zip");

      await expect(extractDocumentText(file, "docx")).resolves.toBeNull();
    });

    it("strips RTF down to its text", () => {
      expect(
        stripRtf(
          "{\\rtf1\\ansi{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\pard Hello \\b world\\b0\\par caf\\'e9 \\{x\\}}",
        ),
      ).toBe("Hello world\ncafé {x}");
    });
  });

  describe("withAttachedDocumentText", () => {
    it("finds escaped mentions of documents only", () => {
      expect(
        mentionedPaths(
          "Attached files: @docs/My\\ Spec.docx @src/a.ts see @deck.pptx.",
        ),
      ).toEqual(["docs/My Spec.docx", "deck.pptx"]);
      expect(documentKind("notes.RTF")).toBe("rtf");
    });

    it("appends each readable document's text", async () => {
      await write(
        "docs/My Spec.docx",
        zip({
          "word/document.xml": "<w:p><w:r><w:t>Body</w:t></w:r></w:p>",
        }),
      );
      const message = "Read this @docs/My\\ Spec.docx";

      await expect(
        withAttachedDocumentText("s1", message, { anywhere: false }),
      ).resolves.toBe(
        `${message}\n\n<attached-document path="docs/My Spec.docx">\nBody\n</attached-document>`,
      );
      expect(capture).toHaveBeenCalledWith("attachment_text_extracted", {
        kind: "docx",
        success: true,
      });
    });

    it("keeps a remote sender inside the worktree", async () => {
      const outside = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "argus-out-"),
      );
      const file = path.join(outside, "secret.docx");
      await fs.promises.writeFile(
        file,
        zip({ "word/document.xml": "<w:p><w:r><w:t>x</w:t></w:r></w:p>" }),
      );
      const message = `@${file}`;

      await expect(
        withAttachedDocumentText("s1", message, { anywhere: false }),
      ).resolves.toBe(message);
      await expect(
        withAttachedDocumentText("s1", message, { anywhere: true }),
      ).resolves.toContain("<attached-document");
      await fs.promises.rm(outside, { recursive: true, force: true });
    });

    it("reports a document it couldn't read", async () => {
      await write("broken.xlsx", "nope");

      await expect(
        withAttachedDocumentText("s1", "@broken.xlsx", { anywhere: false }),
      ).resolves.toBe("@broken.xlsx");
      expect(capture).toHaveBeenCalledWith("attachment_text_extracted", {
        kind: "xlsx",
        success: false,
      });
    });
  });
});
