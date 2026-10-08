/**
 * The definition heuristics per language: what each finds, its container and
 * member kinds, and the calls and locals it must leave alone. Lines are
 * prefiltered by the same patterns ripgrep gets, as in the real index.
 */

import { describe, expect, it } from "vitest";
import {
  extractSymbols,
  languageForPath,
  prefilterPatterns,
} from "./symbolRules";

const prefilter = prefilterPatterns().map((p) => new RegExp(p));

function symbols(file: string, source: string): string[] {
  const language = languageForPath(file);
  if (!language) {
    throw new Error(`no language for ${file}`);
  }
  const lines = source
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => prefilter.some((p) => p.test(text)));

  return extractSymbols(language, lines).map(
    (s) =>
      `${s.kind} ${s.container ? `${s.container}.` : ""}${s.name}:${s.line}:${s.column}`,
  );
}

describe("symbol rules", () => {
  it("finds Swift types, members, extensions and enum cases, not locals or calls", () => {
    const source = [
      "import SwiftUI",
      "@MainActor public final class Store: ObservableObject {",
      "  @Published private(set) var items: [Item] = []",
      "  static let shared = Store()",
      "  func load() async {",
      "    let local = 1",
      "    var other = fetch()",
      "    load()",
      "  }",
      "  class func make() -> Store { Store() }",
      "}",
      "struct ContentView: View {",
      "  var body: some View {",
      "    let inner = 2",
      '    Text("x")',
      "  }",
      "}",
      "enum Mode { case light, dark(Int), `default` }",
      "indirect enum Tree {",
      "  case leaf",
      "  case node(Tree, Tree)",
      "  func depth() -> Int {",
      "    switch self {",
      "    case .leaf: return 0",
      "    }",
      "  }",
      "}",
      "protocol Loader { func fetch() }",
      "extension Store.Item: Identifiable {}",
      "typealias Handler = () -> Void",
      "actor Cache {}",
      "let globalConstant = 3",
      "func topLevel() {}",
    ].join("\n");
    expect(symbols("a.swift", source)).toEqual([
      "class Store:2:30",
      "property Store.items:3:30",
      "property Store.shared:4:13",
      "method Store.load:5:7",
      "method Store.make:10:13",
      "struct ContentView:12:7",
      "property ContentView.body:13:6",
      "enum Mode:18:5",
      "enum Tree:19:14",
      "enum_member Tree.leaf:20:7",
      "enum_member Tree.node:21:7",
      "method Tree.depth:22:7",
      "protocol Loader:28:9",
      "extension Store.Item:29:10",
      "type_alias Handler:30:10",
      "class Cache:31:6",
      "constant globalConstant:32:4",
      "function topLevel:33:5",
    ]);
  });

  it("lists every case of a multi-case line inside an enum body", () => {
    expect(
      symbols("b.swift", "enum E {\n  case a, b(Int), `c` = 3\n}"),
    ).toEqual([
      "enum E:1:5",
      "enum_member E.a:2:7",
      "enum_member E.b:2:10",
      "enum_member E.c:2:19",
    ]);
  });

  it("finds TypeScript declarations and class members, not statements", () => {
    const source = [
      "export default class Store<T> extends Base {",
      "  private items: T[] = [];",
      "  #secret = 1;",
      "  static readonly max = 3;",
      "  constructor(a: string) {",
      "    super();",
      "  }",
      "  async load(id: string): Promise<void> {",
      "    if (id) {",
      "      foo(id);",
      "    }",
      "  }",
      "  get size(): number {",
      "    return 1;",
      "  }",
      "}",
      "export interface Props { a: string }",
      "export type Id = string;",
      "export const enum Mode { A }",
      "declare namespace NS {",
      "}",
      "export async function run(a: number) {",
      "  const inner = 1;",
      "  if (a) {",
      "  }",
      "}",
      "export const handler = async (req: Request) => {",
      "  const x = 2;",
      "};",
      "const LIMIT = 10;",
      "let counter = 0;",
      "foo(bar);",
      "const config = {",
      "  method(a) {",
      "  },",
      "};",
    ].join("\n");
    expect(symbols("a.ts", source)).toEqual([
      "class Store:1:21",
      "property Store.items:2:10",
      "property Store.#secret:3:2",
      "property Store.max:4:18",
      "method Store.load:8:8",
      "method Store.size:13:6",
      "interface Props:17:17",
      "type_alias Id:18:12",
      "enum Mode:19:18",
      "module NS:20:18",
      "function run:22:22",
      "function handler:27:13",
      "constant LIMIT:30:6",
      "variable counter:31:4",
      "constant config:33:6",
    ]);
  });

  it("finds Python classes, methods, functions and constants", () => {
    const source = [
      "MAX_SIZE = 10",
      "class Parser(Base):",
      "    def parse(self, text):",
      "        def helper():",
      "            pass",
      "        parse(text)",
      "async def main():",
      "    x = 1",
      "if MAX_SIZE == 3:",
      "    pass",
    ].join("\n");
    expect(symbols("a.py", source)).toEqual([
      "constant MAX_SIZE:1:0",
      "class Parser:2:6",
      "method Parser.parse:3:8",
      "function helper:4:12",
      "function main:7:10",
    ]);
  });

  it("finds Ruby modules, classes and methods", () => {
    const source = [
      "module Billing",
      "  VERSION = 2",
      "  class Invoice < Base",
      "    def self.build(attrs)",
      "      new(attrs)",
      "    end",
      "    def paid?",
      "    end",
      "  end",
      "end",
    ].join("\n");
    expect(symbols("a.rb", source)).toEqual([
      "module Billing:1:7",
      "constant Billing.VERSION:2:2",
      "class Billing.Invoice:3:8",
      "method Invoice.build:4:13",
      "method Invoice.paid?:7:8",
    ]);
  });

  it("finds Go functions, methods with their receiver, and types", () => {
    const source = [
      "package main",
      "type Server struct {",
      "\tname string",
      "}",
      "type Handler interface {",
      "}",
      "type ID string",
      "func (s *Server) Start(port int) error {",
      "\tgo s.run()",
      "}",
      "func main() {",
      "\tStart(1)",
      "}",
      "const Version = 1",
    ].join("\n");
    expect(symbols("a.go", source)).toEqual([
      "struct Server:2:5",
      "interface Handler:5:5",
      "type_alias ID:7:5",
      "method Server.Start:8:17",
      "function main:11:5",
      "constant Version:14:6",
    ]);
  });

  it("finds Rust items, with impl blocks as containers only", () => {
    const source = [
      "pub struct Point { x: i32 }",
      "pub(crate) enum Shape { Circle }",
      "pub trait Draw {",
      "    fn draw(&self);",
      "}",
      "impl Draw for Point {",
      "    fn draw(&self) {",
      "        helper();",
      "    }",
      "}",
      "pub async fn run() {}",
      "mod tests {",
      "}",
      "const MAX: usize = 3;",
      "type Result<T> = std::result::Result<T, Error>;",
    ].join("\n");
    expect(symbols("a.rs", source)).toEqual([
      "struct Point:1:11",
      "enum Shape:2:16",
      "interface Draw:3:10",
      "method Draw.draw:4:7",
      "method Point.draw:7:7",
      "function run:11:13",
      "module tests:12:4",
      "constant MAX:14:6",
      "type_alias Result:15:5",
    ]);
  });

  it("finds Kotlin classes, objects, functions and properties", () => {
    const source = [
      "data class User(val id: String)",
      "enum class Color { RED }",
      "sealed interface Event",
      "object Registry {",
      "    private val users = mutableListOf<User>()",
      "    suspend fun load(id: String): User {",
      "        val local = 1",
      "        return find(id)",
      "    }",
      "}",
      "fun String.slug(): String = lowercase()",
      "typealias Callback = () -> Unit",
    ].join("\n");
    expect(symbols("a.kt", source)).toEqual([
      "class User:1:11",
      "enum Color:2:11",
      "interface Event:3:17",
      "class Registry:4:7",
      "property Registry.users:5:16",
      "method Registry.load:6:16",
      "function slug:11:11",
      "type_alias Callback:12:10",
    ]);
  });

  it("finds Java types, methods and fields, not statements", () => {
    const source = [
      "public final class Service {",
      "    private static final int LIMIT = 3;",
      "    @Override",
      "    public List<String> names(int count) throws IOException {",
      "        int x = compute(count);",
      "        return helper(x);",
      "    }",
      "    void reset();",
      "}",
      "interface Repo {}",
      "enum Kind { A, B }",
      "record Pair(int a, int b) {}",
    ].join("\n");
    expect(symbols("A.java", source)).toEqual([
      "class Service:1:19",
      "property Service.LIMIT:2:29",
      "method Service.names:4:24",
      "method Service.reset:8:9",
      "interface Repo:10:10",
      "enum Kind:11:5",
      "class Pair:12:7",
    ]);
  });

  it("finds Objective-C interfaces, protocols, methods and properties", () => {
    const source = [
      "@protocol Fetching;",
      "@protocol Loading <NSObject>",
      "- (void)load;",
      "@end",
      "@interface Store : NSObject",
      "@property (nonatomic, strong) NSArray *items;",
      "- (instancetype)initWithName:(NSString *)name;",
      "+ (Store *)shared;",
      "@end",
      "@interface Store (Private)",
      "@end",
      "@implementation Store",
      "- (void)reload {",
      "    [self load];",
      "}",
      "@end",
    ].join("\n");
    expect(symbols("Store.m", source)).toEqual([
      "protocol Loading:2:10",
      "method Loading.load:3:8",
      "class Store:5:11",
      "property Store.items:6:39",
      "method Store.initWithName:7:16",
      "method Store.shared:8:11",
      "extension Store:10:11",
      "method Store.reload:13:8",
    ]);
  });

  it("ignores files it has no rules for", () => {
    expect(languageForPath("README.md")).toBeNull();
    expect(languageForPath("dir.ts/Makefile")).toBeNull();
    expect(languageForPath("src/App.TSX")?.name).toBe("typescript");
  });
});
