/**
 * The grammars behind `CodeViewer`, loaded on first use so the highlighter
 * stays out of the main bundle. Output is per line, as runs of text with
 * highlight.js scopes, so the viewer can number lines and style scopes with
 * its own CSS module.
 */

import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dart from "highlight.js/lib/languages/dart";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import groovy from "highlight.js/lib/languages/groovy";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import lua from "highlight.js/lib/languages/lua";
import makefile from "highlight.js/lib/languages/makefile";
import markdown from "highlight.js/lib/languages/markdown";
import objectivec from "highlight.js/lib/languages/objectivec";
import perl from "highlight.js/lib/languages/perl";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

export interface CodeRun {
  text: string;
  /** highlight.js scopes without the `hljs-` prefix, outermost first. */
  scopes: string[];
}

export type CodeLine = CodeRun[];

const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  dart,
  diff,
  dockerfile,
  go,
  graphql,
  groovy,
  ini,
  java,
  javascript,
  json,
  kotlin,
  less,
  lua,
  makefile,
  markdown,
  objectivec,
  perl,
  php,
  python,
  r,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
});

interface HastText {
  type: "text";
  value: string;
}

interface HastElement {
  type: "element";
  properties?: { className?: unknown };
  children: HastNode[];
}

type HastNode = HastElement | HastText | { type: string };

function scopesOf(node: HastElement): string[] {
  const names = node.properties?.className;
  if (!Array.isArray(names)) {
    return [];
  }

  return names
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.replace(/^hljs-/, ""));
}

export function isHighlightable(language: string): boolean {
  return lowlight.registered(language);
}

/** `code` split into lines of scoped runs; null when the language isn't bundled. */
export function highlightLines(
  code: string,
  language: string,
): CodeLine[] | null {
  if (!lowlight.registered(language)) {
    return null;
  }
  const tree = lowlight.highlight(language, code);
  const lines: CodeLine[] = [[]];
  const walk = (nodes: readonly HastNode[], scopes: string[]) => {
    for (const node of nodes) {
      if (node.type === "text") {
        const parts = (node as HastText).value.split("\n");
        parts.forEach((part, i) => {
          if (i > 0) {
            lines.push([]);
          }
          if (part) {
            lines[lines.length - 1].push({ text: part, scopes });
          }
        });
      } else if (node.type === "element") {
        const element = node as HastElement;
        walk(element.children, [...scopes, ...scopesOf(element)]);
      }
    }
  };
  walk(tree.children as HastNode[], []);

  return lines;
}
