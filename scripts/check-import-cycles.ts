/**
 * Fails the build on a *new* circular import.
 *
 * A cycle is not just untidy here: the bundler has to break it somewhere, and
 * it does that by emitting one module's body after the module that reads it.
 * `var` hoisting then hands the reader `undefined` instead of the export. That
 * is how every automation run started failing with
 * "Cannot read properties of undefined (reading 'id')" — a table of signal
 * sources was built 9,500 lines before one of the sources was assigned.
 *
 * `import/no-cycle` does not fire on this repo's TS setup, so the check lives
 * here. The cycles already present are listed in BASELINE: they are debt, not
 * permission. Deleting one from the list once it is untangled is the point;
 * adding one is a decision to ship the bug class above.
 *
 * Type-only imports are erased before bundling, so they cannot cycle and are
 * not followed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { error, info } from "../app/lib/logger";

const REPO_ROOT = resolve(import.meta.dirname, "..");

const SEARCH_ROOTS = [
  "packages/host/src",
  "packages/peacock/src",
  "app",
  "src",
  "electron",
];

/**
 * Cycles that predate this check, each as its files in dependency order.
 * Shrink this list; never grow it.
 */
const BASELINE: string[][] = [
  ["app/lib/lastKnownCapabilities.ts", "app/stores/conversationStore.ts"],
  ["electron/ipc.ts", "electron/main.ts"],
  [
    "packages/host/src/services/agent/agentService.ts",
    "packages/host/src/services/mcp/server.ts",
    "packages/host/src/services/notifications/push.ts",
    "packages/host/src/services/notifications/osNotification.ts",
  ],
  [
    "app/lib/ipc.ts",
    "app/lib/transport/hostRouting.ts",
    "app/lib/router.tsx",
    "app/lib/telemetry.ts",
  ],
  [
    "packages/host/src/services/agent/agentService.ts",
    "packages/host/src/services/mcp/server.ts",
    "packages/host/src/services/mcp/automationTools.ts",
    "packages/host/src/services/automation/autoStart.ts",
    "packages/host/src/services/automation/proposals/accept.ts",
  ],
  [
    "app/lib/ipc.ts",
    "app/lib/transport/index.ts",
    "app/stores/connectionStore.ts",
    "app/lib/routeHooks.ts",
    "app/lib/router.tsx",
    "app/lib/telemetry.ts",
  ],
  [
    "packages/host/src/services/agent/agentService.ts",
    "packages/host/src/services/mcp/server.ts",
    "packages/host/src/services/notifications/push.ts",
    "packages/host/src/services/notifications/osNotification.ts",
    "packages/host/src/services/notifications/broadcast.ts",
    "packages/host/src/services/remote/push/dispatch.ts",
    "packages/host/src/services/remote/gateway.ts",
    "packages/host/src/services/remote/capabilities.ts",
  ],
  [
    "packages/host/src/services/agent/agentService.ts",
    "packages/host/src/services/mcp/server.ts",
    "packages/host/src/services/notifications/push.ts",
    "packages/host/src/services/notifications/osNotification.ts",
    "packages/host/src/services/notifications/broadcast.ts",
    "packages/host/src/services/remote/push/dispatch.ts",
    "packages/host/src/services/remote/gateway.ts",
    "packages/host/src/services/remote/capabilities.ts",
    "packages/host/src/services/automation/runner.ts",
  ],
];

/** Value imports only — `import type` is erased and cannot cycle. */
const IMPORT_RE = /^\s*import\s+(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm;

const SKIP_FILE_RE = /\.(test|spec|stories)\.tsx?$/;

function walk(dir: string, out: string[] = []): string[] {
  // Sorted: DFS discovers a different set of back edges per traversal order,
  // and readdir order is not the same on APFS and ext4. An order-dependent
  // baseline would fail on CI and pass locally.
  for (const name of [...readdirSync(dir)].sort()) {
    if (name.startsWith(".") || name === "node_modules") {
      continue;
    }
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !SKIP_FILE_RE.test(name)) {
      out.push(p);
    }
  }

  return out;
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) {
    return null;
  }
  const base = resolve(dirname(from), spec);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const root of SEARCH_ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs)) {
      continue;
    }
    for (const file of walk(abs)) {
      const source = readFileSync(file, "utf8");
      const edges: string[] = [];
      for (const match of source.matchAll(IMPORT_RE)) {
        const target = resolveImport(file, match[1]);
        if (target) {
          edges.push(target);
        }
      }
      graph.set(file, edges);
    }
  }

  return graph;
}

/** Rotate to a stable starting point so the same loop always prints alike. */
function canonical(cycle: string[]): string {
  const first = [...cycle].sort()[0];
  const at = cycle.indexOf(first);

  return [...cycle.slice(at), ...cycle.slice(0, at)].join(" -> ");
}

function findCycles(graph: Map<string, string[]>): string[] {
  const found = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    if (state.get(node) === 2) {
      return;
    }
    if (state.get(node) === 1) {
      const at = stack.indexOf(node);
      found.add(canonical(stack.slice(at).map((p) => relative(REPO_ROOT, p))));

      return;
    }
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      visit(next);
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of [...graph.keys()].sort()) {
    visit(node);
  }

  return [...found];
}

function main(): void {
  const cycles = findCycles(buildGraph());
  const baseline = new Set(BASELINE.map(canonical));
  const added = cycles.filter((c) => !baseline.has(c));
  const fixed = [...baseline].filter((b) => !cycles.includes(b));

  if (added.length > 0) {
    error(
      [
        `New circular import${added.length === 1 ? "" : "s"} (${added.length}):`,
        ...added.map((c) => `  ${c.split(" -> ").join("\n    -> ")}`),
        "",
        "Break the cycle — usually by moving the shared constant or type into a",
        "leaf module both sides can import. See the header of this script.",
      ].join("\n"),
    );
    process.exit(1);
  }

  if (fixed.length > 0) {
    info(
      [
        `${fixed.length} baseline cycle${fixed.length === 1 ? " is" : "s are"} gone — remove from BASELINE in ${relative(REPO_ROOT, import.meta.filename)}:`,
        ...fixed.map((c) => `  ${c}`),
      ].join("\n"),
    );
  }
}

main();
