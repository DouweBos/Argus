/**
 * Minimal markdown renderer for RN — headings, fenced code, lists, blockquotes,
 * rules and inline code/bold/italic/links. Deliberately small: transcripts are
 * agent output, not arbitrary documents, and a full parser isn't worth the
 * bundle on a phone.
 */

import { Fragment, type ReactNode } from "react";
import {
  Linking,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { MONO_FAMILY } from "./ui";
import { useTheme, type Theme } from "../theme";

interface Block {
  type: "code" | "heading" | "list" | "paragraph" | "quote" | "rule";
  text?: string;
  lang?: string;
  level?: number;
  items?: { text: string; ordered: boolean; marker: string }[];
}

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Block["items"] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list && list.length > 0) {
      blocks.push({ type: "list", items: list });
      list = [];
    }
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flush();
      const lang = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", text: body.join("\n"), lang });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flush();
      blocks.push({ type: "quote", text: quote[1] });
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || ordered) {
      flushParagraph();
      list = list ?? [];
      list.push(
        bullet
          ? { text: bullet[1], ordered: false, marker: "•" }
          : { text: ordered![2], ordered: true, marker: `${ordered![1]}.` },
      );
      continue;
    }

    if (line.trim() === "") {
      flush();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flush();

  return blocks;
}

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: InlineToken[] }
  | { kind: "italic"; children: InlineToken[] }
  | { kind: "link"; children: InlineToken[]; href: string };

const INLINE_RE = new RegExp(
  [
    "(`[^`]+`)", // code
    "(\\*\\*[^*]+\\*\\*)", // **bold**
    "(__[^_]+__)", // __bold__
    "(\\*[^*\\n]+\\*)", // *italic*
    "(_[^_\\n]+_)", // _italic_
    // [label](href) — one level of balanced parens so wiki-style URLs survive
    "(\\[[^\\]]*\\]\\((?:[^()\\s]|\\([^()\\s]*\\))+\\))",
    "(<https?://[^>\\s]+>)", // <autolink>
    "(https?://[^\\s<]+)", // bare URL
  ].join("|"),
  "g",
);

/** Trailing sentence punctuation is prose, not part of a bare URL. */
function trimUrlTail(url: string): { href: string; tail: string } {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1];
    if (ch === ")") {
      // Only shed the paren when it closes something outside the URL.
      const inner = url.slice(0, end);
      if (inner.split("(").length > inner.split(")").length) {
        break;
      }
    } else if (!".,;:!?'\"]}>".includes(ch)) {
      break;
    }
    end--;
  }

  return { href: url.slice(0, end), tail: url.slice(end) };
}

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let last = 0;
  const pushText = (t: string) => {
    if (t.length > 0) {
      tokens.push({ kind: "text", text: t });
    }
  };

  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0;
    if (index > last) {
      pushText(text.slice(last, index));
    }
    const raw = match[0];
    last = index + raw.length;

    if (raw.startsWith("`")) {
      tokens.push({ kind: "code", text: raw.slice(1, -1) });
      continue;
    }
    if (raw.startsWith("**") || raw.startsWith("__")) {
      tokens.push({ kind: "bold", children: parseInline(raw.slice(2, -2)) });
      continue;
    }
    if (raw.startsWith("[")) {
      const m = raw.match(/^\[([^\]]*)\]\((.+)\)$/);
      const href = m?.[2]?.replace(/^<|>$/g, "") ?? "";
      const label = m?.[1] ?? raw;
      const children =
        label.length > 0
          ? parseInline(label)
          : [{ kind: "text" as const, text: href }];
      if (isOpenable(href)) {
        tokens.push({ kind: "link", children, href });
      } else {
        tokens.push(...children);
      }
      continue;
    }
    if (raw.startsWith("<")) {
      const href = raw.slice(1, -1);
      tokens.push({
        kind: "link",
        children: [{ kind: "text", text: href }],
        href,
      });
      continue;
    }
    if (raw.startsWith("http")) {
      const { href, tail } = trimUrlTail(raw);
      tokens.push({
        kind: "link",
        children: [{ kind: "text", text: href }],
        href,
      });
      pushText(tail);
      continue;
    }
    tokens.push({ kind: "italic", children: parseInline(raw.slice(1, -1)) });
  }
  pushText(text.slice(last));

  return tokens;
}

/** Only schemes the OS can actually open get link styling — a dead blue underline reads as broken. */
function isOpenable(href: string): boolean {
  return /^(?:https?|mailto|tel):/i.test(href);
}

function openHref(href: string): void {
  Linking.openURL(href).catch(() => {});
}

function renderTokens(
  tokens: InlineToken[],
  theme: Theme,
  keyPrefix = "",
): ReactNode[] {
  return tokens.map((t, i) => {
    const key = `${keyPrefix}${i}`;
    switch (t.kind) {
      case "code":
        return (
          <Text
            key={key}
            style={{
              fontFamily: MONO_FAMILY,
              fontSize: 12.5,
              color: theme.accent,
            }}
          >
            {t.text}
          </Text>
        );
      case "bold":
        return (
          <Text key={key} style={{ fontWeight: "700" }}>
            {renderTokens(t.children, theme, `${key}.`)}
          </Text>
        );
      case "italic":
        return (
          <Text key={key} style={{ fontStyle: "italic" }}>
            {renderTokens(t.children, theme, `${key}.`)}
          </Text>
        );
      case "link":
        return (
          <Text
            key={key}
            style={{ color: theme.accent, textDecorationLine: "underline" }}
            onPress={() => openHref(t.href)}
          >
            {renderTokens(t.children, theme, `${key}.`)}
          </Text>
        );
      default:
        return <Fragment key={key}>{t.text}</Fragment>;
    }
  });
}

function Inline({
  text,
  theme,
  style,
}: {
  text: string;
  theme: Theme;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={[{ color: theme.text, fontSize: 14, lineHeight: 20 }, style]}>
      {renderTokens(parseInline(text), theme)}
    </Text>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const theme = useTheme();

  return (
    <View
      style={{
        backgroundColor: theme.bgTertiary,
        borderRadius: theme.radiusSm,
        borderWidth: 1,
        borderColor: theme.borderSubtle,
        padding: 10,
        gap: 4,
      }}
    >
      {lang ? (
        <Text
          style={{ color: theme.textMuted, fontSize: 10, fontWeight: "700" }}
        >
          {lang.toUpperCase()}
        </Text>
      ) : null}
      <Text
        style={{
          color: theme.textSecondary,
          fontFamily: MONO_FAMILY,
          fontSize: 12,
          lineHeight: 17,
        }}
      >
        {code}
      </Text>
    </View>
  );
}

export function Markdown({ text }: { text: string }): ReactNode {
  const theme = useTheme();
  const blocks = parseBlocks(text);

  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "code":
            return <CodeBlock key={i} code={b.text ?? ""} lang={b.lang} />;
          case "heading":
            return (
              <Inline
                key={i}
                text={b.text ?? ""}
                theme={theme}
                style={{
                  fontSize: b.level === 1 ? 19 : b.level === 2 ? 17 : 15,
                  fontWeight: "700",
                  marginTop: i === 0 ? 0 : 4,
                }}
              />
            );
          case "rule":
            return (
              <View
                key={i}
                style={{
                  height: 1,
                  backgroundColor: theme.border,
                  marginVertical: 4,
                }}
              />
            );
          case "quote":
            return (
              <View
                key={i}
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: theme.border,
                  paddingLeft: 8,
                }}
              >
                <Inline
                  text={b.text ?? ""}
                  theme={theme}
                  style={{ color: theme.textSecondary }}
                />
              </View>
            );
          case "list":
            return (
              <View key={i} style={{ gap: 4 }}>
                {(b.items ?? []).map((item, j) => (
                  <View key={j} style={{ flexDirection: "row", gap: 8 }}>
                    <Text
                      style={{
                        color: theme.textMuted,
                        fontSize: 14,
                        lineHeight: 20,
                      }}
                    >
                      {item.marker}
                    </Text>
                    <Inline
                      text={item.text}
                      theme={theme}
                      style={{ flex: 1 }}
                    />
                  </View>
                ))}
              </View>
            );
          default:
            return <Inline key={i} text={b.text ?? ""} theme={theme} />;
        }
      })}
    </View>
  );
}
