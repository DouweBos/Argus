/**
 * `docs/telemetry-events.md` is published to houwert.dev as the promise of
 * what Argus sends. Nothing else checks it against the code, so a new event
 * or prop could ship undocumented and the public page would quietly lie.
 *
 * This test reads every catalog — the host's `EventMap`, the web client's
 * `EventMap`, the iOS client's `TelemetryEvent`, the Mac app's
 * `MacTelemetryEvent`, Argus Server's `ServerTelemetryEvent`, the Android
 * client's `TelemetryEvent` — and the doc, and fails when they disagree, in
 * either direction: undocumented events, undocumented props, documented
 * events that no longer exist, and catalog entries nothing ever sends.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const DOC = path.join(REPO, "docs/telemetry-events.md");
const HOST_CATALOG = path.join(REPO, "packages/host/src/telemetryEvents.ts");
const WEB_CATALOG = path.join(
  REPO,
  "clients/argus-web/src/telemetry/events.ts",
);
const IOS_CATALOG = path.join(
  REPO,
  "clients/apple/ArgusRemote/Telemetry/TelemetryEvent.swift",
);
const MAC_CATALOG = path.join(
  REPO,
  "clients/apple/ArgusDesktop/Telemetry/MacTelemetryEvent.swift",
);
const SERVER_CATALOG = path.join(
  REPO,
  "clients/apple/ArgusServer/Telemetry/ServerTelemetryEvent.swift",
);
const ANDROID_CATALOG = path.join(
  REPO,
  "clients/android/app/src/main/kotlin/dev/houwert/argus/app/telemetry/TelemetryEvent.kt",
);
/** Where a `capture(...)` call can plausibly live. */
const HOST_SOURCES = ["packages", "clients/argus-web/src"];
const WEB_SOURCES = ["clients/argus-web/src"];
const IOS_SOURCES = ["clients/apple/ArgusRemote"];
const MAC_SOURCES = ["clients/apple/ArgusDesktop"];
const SERVER_SOURCES = ["clients/apple/ArgusServer"];
const ANDROID_SOURCES = ["clients/android/app/src/main"];

/**
 * Android events ported with the iPhone catalog whose screens are still being
 * built. Each one leaves this list in the change that first captures it.
 */
const ANDROID_PENDING = new Set([
  "android_pair_failed",
  "android_saved_shown",
  "android_device_watched",
  "android_image_viewer_used",
  "android_sessions_fold_toggled",
  "android_project_collapse_toggled",
  "android_proposal_opened",
  "android_inbox_filtered",
  "android_follow_up_used",
  "android_input_used",
  "android_agent_start_submitted",
  "android_share_finished",
  "android_warnings_opened",
  "android_notifications_cleared",
  "android_mcp_servers_opened",
  "android_session_used",
  "android_home_used",
  "android_new_session_opened",
  "android_blueprint_opened",
  "android_transcript_work_log_opened",
  "android_artifact_opened",
  "android_message_action",
  "android_chat_history_used",
  "android_file_viewed",
  "android_design_opened",
  "android_design_layer_selected",
  "android_file_search_run",
  "android_issue_searched",
  "android_account_signed_in",
  "android_account_signed_out",
  "android_account_member_auth",
  "android_account_removed_notice",
  "android_member_removed",
  "android_member_renamed",
  "android_computer_added",
  "android_join_acted",
  "android_device_name_changed",
  "android_account_reset",
  "android_account_push_registered",
  "android_account_woken",
]);

/**
 * Events whose prop shape PostHog dictates rather than us. They're documented
 * in prose, sent by hand, and deliberately absent from both catalogs.
 */
const MAGIC_EVENTS = new Set([
  "$exception",
  "$pageview",
  "$screen",
  "user_feedback",
]);

interface Event {
  name: string;
  props: string[];
  /** The literal a `capture(...)` call site would contain. */
  usage: string;
}

/** Top-level keys of `EventMap`, with the prop names of each. */
function hostEvents(source: string): Event[] {
  const start = source.indexOf("export interface EventMap {");
  const body = source.slice(start, source.indexOf("\n}\n", start));
  const events: Event[] = [];
  const lines = body.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^ {2}([a-z][\w$]*): (.*)$/.exec(lines[i]);
    if (!match) {
      continue;
    }
    const [, name, rest] = match;
    const usage = `"${name}"`;
    if (rest.startsWith("undefined")) {
      events.push({ name, props: [], usage });
      continue;
    }
    // Either `{ a: A; b: B };` on one line, or a block closed by `  };`.
    let block = rest;
    while (!block.trimEnd().endsWith("};") && i + 1 < lines.length) {
      i += 1;
      block += `\n${lines[i]}`;
    }
    events.push({ name, props: propNames(block), usage });
  }

  return events;
}

function propNames(block: string): string[] {
  return [...block.matchAll(/([a-z][\w$]*)\s*:/g)].map((m) => m[1]);
}

/**
 * A Swift catalog's (iOS or Mac) two switches: `name` maps each case to its event name,
 * `properties` maps it to the dictionary keys it sends.
 */
function swiftEvents(source: string): Event[] {
  const names = new Map<string, string>();
  for (const match of source.matchAll(/case \.(\w+): "([^"]+)"/g)) {
    names.set(match[1], match[2]);
  }

  const block = source.slice(source.indexOf("var properties: [String: Any] {"));
  const props = new Map<string, string[]>();
  for (const chunk of block.split(/\n {4}case /).slice(1)) {
    const cases = [
      ...chunk.slice(0, chunk.indexOf(":")).matchAll(/\.(\w+)/g),
    ].map((m) => m[1]);
    const keys = [...chunk.matchAll(/"([a-z][\w$]*)":/g)].map((m) => m[1]);
    for (const name of cases) {
      props.set(name, keys);
    }
  }

  return [...names].map(([swiftCase, name]) => ({
    name,
    props: props.get(swiftCase) ?? [],
    usage: `.${swiftCase}`,
  }));
}

/**
 * The Android catalog: one `data class` / `data object` per event, its name in
 * `override val name = "…"` and its props as `"key" to …` pairs.
 */
function kotlinEvents(source: string): Event[] {
  return source
    .split(/\n {2}data (?:class|object) /)
    .slice(1)
    .flatMap((chunk) => {
      const name = /override val name = "([^"]+)"/.exec(chunk)?.[1];
      if (!name) {
        return [];
      }
      const props = [...chunk.matchAll(/"([a-z][\w$]*)" to /g)].map(
        (m) => m[1],
      );

      return [
        { name, props, usage: `TelemetryEvent.${/^\w+/.exec(chunk)?.[0]}` },
      ];
    });
}

/**
 * Rows of the catalog tables, keyed by event name. Only tables whose first
 * column is `Event` count — the mode and route-pattern tables are prose.
 */
function documentedRows(doc: string): Map<string, string> {
  const rows = new Map<string, string>();
  let inCatalog = false;

  for (const line of doc.split("\n")) {
    if (!line.startsWith("|")) {
      inCatalog = false;
      continue;
    }
    const first = (line.split("|")[1] ?? "").trim();
    if (!inCatalog) {
      inCatalog = first === "Event";
      continue;
    }
    for (const match of first.matchAll(/`([^`]+)`/g)) {
      if (/^\$?[a-z][a-z0-9_]*$/.test(match[1])) {
        rows.set(match[1], line);
      }
    }
  }

  return rows;
}

/** Whether `needle` appears inside a backticked span of `text`. */
function mentionsInCode(text: string, needle: string): boolean {
  const word = new RegExp(`\\b${needle}\\b`);

  return [...text.matchAll(/`([^`]+)`/g)].some((m) => word.test(m[1]));
}

function sourceFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const skip = ["node_modules", "dist", "build", ".git"];

      return skip.includes(entry.name) ? [] : sourceFiles(full, extensions);
    }

    return extensions.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
  });
}

function read(roots: string[], extensions: string[], exclude: string): string {
  return roots
    .flatMap((root) => sourceFiles(path.join(REPO, root), extensions))
    .filter((file) => file !== exclude)
    .map((file) => fs.readFileSync(file, "utf-8"))
    .join("\n");
}

const doc = fs.readFileSync(DOC, "utf-8");
const rows = documentedRows(doc);
const host = hostEvents(fs.readFileSync(HOST_CATALOG, "utf-8"));
// Same `EventMap` shape as the host's, so the same parser reads it.
const web = hostEvents(fs.readFileSync(WEB_CATALOG, "utf-8"));
const ios = swiftEvents(fs.readFileSync(IOS_CATALOG, "utf-8"));
const mac = swiftEvents(fs.readFileSync(MAC_CATALOG, "utf-8"));
const server = swiftEvents(fs.readFileSync(SERVER_CATALOG, "utf-8"));
const android = kotlinEvents(fs.readFileSync(ANDROID_CATALOG, "utf-8"));
const catalog = [...host, ...web, ...ios, ...mac, ...server, ...android];

describe("docs/telemetry-events.md", () => {
  it("reads both catalogs", () => {
    // A parser that silently matched nothing would pass every check below.
    expect(host.length).toBeGreaterThan(10);
    expect(web.length).toBeGreaterThan(5);
    expect(ios.length).toBeGreaterThan(10);
    expect(mac.length).toBeGreaterThan(5);
    expect(server.length).toBeGreaterThan(5);
    expect(android.length).toBeGreaterThan(10);
    expect(rows.size).toBeGreaterThan(10);
  });

  it.each(catalog)("documents $name", ({ name }) => {
    expect(doc, `${name} is missing from docs/telemetry-events.md`).toContain(
      `\`${name}\``,
    );
  });

  it.each(catalog.filter((event) => event.props.length > 0))(
    "documents every prop of $name",
    ({ name, props }) => {
      // Events documented in prose rather than a catalog row are checked
      // against the whole doc; the rest against their own row.
      const scope = rows.get(name) ?? doc;
      for (const prop of props) {
        expect(
          mentionsInCode(scope, prop),
          `${name} sends \`${prop}\`, which the docs don't mention`,
        ).toBe(true);
      }
    },
  );

  it("lists no event that has been renamed or removed", () => {
    const known = new Set(catalog.map((event) => event.name));
    const stale = [...rows.keys()].filter(
      (name) => !known.has(name) && !MAGIC_EVENTS.has(name),
    );
    expect(stale, "documented but in no catalog").toEqual([]);
  });
});

describe("telemetry catalogs", () => {
  it("declares no host event nothing sends", () => {
    const sources = read(HOST_SOURCES, [".ts", ".tsx"], HOST_CATALOG);
    const dead = host
      .filter((event) => !sources.includes(event.usage))
      .map((event) => event.name);
    expect(dead, "in EventMap but never captured").toEqual([]);
  });

  it("declares no web event nothing sends", () => {
    const sources = read(WEB_SOURCES, [".ts", ".tsx"], WEB_CATALOG);
    const dead = web
      .filter((event) => !sources.includes(event.usage))
      .map((event) => event.name);
    expect(dead, "in the web EventMap but never captured").toEqual([]);
  });

  it("declares no iOS event nothing sends", () => {
    const sources = read(IOS_SOURCES, [".swift"], IOS_CATALOG);
    const dead = ios
      .filter((event) => !sources.includes(event.usage))
      .map((event) => event.name);
    expect(dead, "in TelemetryEvent but never captured").toEqual([]);
  });

  it("declares no Mac event nothing sends", () => {
    const sources = read(MAC_SOURCES, [".swift"], MAC_CATALOG);
    const dead = mac
      .filter((event) => !sources.includes(event.usage))
      .map((event) => event.name);
    expect(dead, "in MacTelemetryEvent but never captured").toEqual([]);
  });

  it("declares no server event nothing sends", () => {
    const sources = read(SERVER_SOURCES, [".swift"], SERVER_CATALOG);
    const dead = server
      .filter((event) => !sources.includes(event.usage))
      .map((event) => event.name);
    expect(dead, "in ServerTelemetryEvent but never captured").toEqual([]);
  });

  it("declares no Android event nothing sends", () => {
    const sources = read(ANDROID_SOURCES, [".kt"], ANDROID_CATALOG);
    const captured = (event: Event) =>
      new RegExp(`\\b${event.usage.replace(".", "\\.")}\\b`).test(sources);
    const dead = android
      .filter((event) => !captured(event) && !ANDROID_PENDING.has(event.name))
      .map((event) => event.name);
    expect(dead, "in the Android TelemetryEvent but never captured").toEqual(
      [],
    );
    const wired = android
      .filter((event) => captured(event) && ANDROID_PENDING.has(event.name))
      .map((event) => event.name);
    expect(wired, "captured now: drop from ANDROID_PENDING").toEqual([]);
    const unknown = [...ANDROID_PENDING].filter(
      (name) => !android.some((event) => event.name === name),
    );
    expect(unknown, "in ANDROID_PENDING but not in the catalog").toEqual([]);
  });
});
