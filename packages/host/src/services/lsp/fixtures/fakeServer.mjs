// A tiny stdio language server for the manager's tests. Flags:
//   --sync=full|incremental   how it wants didChange (default incremental)
//   --crash-on-init           exits instead of answering initialize
// Every line containing ERROR becomes a diagnostic.

import process from "node:process";
import rpc from "vscode-jsonrpc/node";

const args = process.argv.slice(2);
const sync = args.includes("--sync=full") ? 1 : 2;
const connection = rpc.createMessageConnection(
  new rpc.StreamMessageReader(process.stdin),
  new rpc.StreamMessageWriter(process.stdout),
);

const docs = new Map();
const watched = [];
let configuration = null;

function publish(uri) {
  const doc = docs.get(uri);
  const diagnostics = [];
  doc.text.split("\n").forEach((line, i) => {
    const at = line.indexOf("ERROR");
    if (at >= 0) {
      diagnostics.push({
        range: {
          start: { line: i, character: at },
          end: { line: i, character: at + 5 },
        },
        severity: 1,
        message: "bad",
        source: "fake",
        code: 42,
      });
    }
  });
  connection.sendNotification("textDocument/publishDiagnostics", {
    uri,
    version: doc.version,
    diagnostics,
  });
}

function offsetAt(text, pos) {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < pos.line; i++) {
    offset += lines[i].length + 1;
  }

  return offset + pos.character;
}

connection.onRequest("initialize", async (params) => {
  if (args.includes("--crash-on-init")) {
    process.exit(7);
  }
  connection
    .sendRequest("workspace/configuration", {
      items: [{ section: "fake" }],
    })
    .then((result) => {
      configuration = result;
    });

  return {
    capabilities: {
      textDocumentSync: { openClose: true, change: sync },
      hoverProvider: true,
      definitionProvider: true,
      completionProvider: { resolveProvider: true, triggerCharacters: ["."] },
      codeActionProvider: true,
      executeCommandProvider: { commands: ["fake.fix"] },
    },
    serverInfo: { name: "fake", version: String(params.processId) },
  };
});
connection.onNotification("initialized", () => undefined);
connection.onNotification("workspace/didChangeConfiguration", () => undefined);
connection.onNotification("textDocument/didOpen", ({ textDocument }) => {
  docs.set(textDocument.uri, {
    text: textDocument.text,
    version: textDocument.version,
  });
  publish(textDocument.uri);
});
connection.onNotification(
  "textDocument/didChange",
  ({ textDocument, contentChanges }) => {
    const doc = docs.get(textDocument.uri);
    for (const change of contentChanges) {
      if (!change.range) {
        doc.text = change.text;
      } else {
        const start = offsetAt(doc.text, change.range.start);
        const end = offsetAt(doc.text, change.range.end);
        doc.text = doc.text.slice(0, start) + change.text + doc.text.slice(end);
      }
    }
    doc.version = textDocument.version;
    publish(textDocument.uri);
  },
);
connection.onNotification("textDocument/didClose", ({ textDocument }) => {
  docs.delete(textDocument.uri);
});
connection.onNotification("workspace/didChangeWatchedFiles", ({ changes }) => {
  watched.push(...changes);
});
connection.onNotification("fake/crash", () => process.exit(3));
connection.onRequest("fake/state", () => ({
  pid: process.pid,
  docs: Object.fromEntries(
    [...docs].map(([uri, d]) => [uri, { text: d.text, version: d.version }]),
  ),
  watched,
  configuration,
}));
connection.onRequest("textDocument/hover", ({ textDocument }) => ({
  contents: {
    kind: "markdown",
    value: `**${docs.get(textDocument.uri).text.length}**`,
  },
}));
connection.onRequest("textDocument/definition", ({ textDocument }) => [
  {
    uri: textDocument.uri,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  },
  {
    uri: "file:///etc/hosts",
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  },
]);
connection.onRequest("textDocument/completion", () => ({
  isIncomplete: false,
  items: [{ label: "alpha", kind: 3, data: { id: 1 } }],
}));
connection.onRequest("completionItem/resolve", (item) => ({
  ...item,
  documentation: { kind: "markdown", value: `docs for ${item.label}` },
}));
connection.onRequest("textDocument/codeAction", ({ textDocument, context }) => [
  {
    title: `Fix ${context.diagnostics.length}`,
    kind: "quickfix",
    command: {
      title: "fix",
      command: "fake.fix",
      arguments: [textDocument.uri],
    },
  },
]);
connection.onRequest(
  "workspace/executeCommand",
  async ({ arguments: [uri] }) => {
    await connection.sendRequest("workspace/applyEdit", {
      edit: {
        changes: {
          [uri]: [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: "// fixed\n",
            },
          ],
        },
      },
    });

    return null;
  },
);
connection.onRequest("shutdown", () => null);
connection.onNotification("exit", () => process.exit(0));
connection.listen();
