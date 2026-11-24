/**
 * Markdown (what agents write) to Slack's mrkdwn. Code is left alone; Slack's
 * control characters are escaped everywhere else.
 */

const FENCE = /^\s*(```|~~~)/;

export function markdownToMrkdwn(markdown: string): string {
  const out: string[] = [];
  let inCode = false;
  let table: string[] = [];
  const flushTable = (): void => {
    if (table.length) {
      // Slack has no tables; monospace keeps the columns lined up.
      out.push("```", ...table.map(escapeText), "```");
      table = [];
    }
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (FENCE.test(line)) {
      flushTable();
      // The language tag would show as text in Slack.
      out.push("```");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeText(line));
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (!/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
        table.push(line.trim());
      }
      continue;
    }
    flushTable();
    out.push(convertLine(line));
  }
  flushTable();
  if (inCode) {
    out.push("```");
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function convertLine(line: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
  if (heading) {
    return `*${inline(stripEmphasis(heading[1]!))}*`;
  }
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
    return "───";
  }
  const quote = /^\s*>\s?(.*)$/.exec(line);
  if (quote) {
    return `> ${inline(quote[1]!)}`;
  }
  const task = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
  if (task) {
    const done = task[2] !== " ";

    return `${indent(task[1]!)}${done ? "☑" : "☐"} ${inline(task[3]!)}`;
  }
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) {
    return `${indent(bullet[1]!)}• ${inline(bullet[2]!)}`;
  }
  const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
  if (numbered) {
    return `${indent(numbered[1]!)}${numbered[2]}. ${inline(numbered[3]!)}`;
  }

  return inline(line);
}

function indent(spaces: string): string {
  return "    ".repeat(Math.floor(spaces.replace(/\t/g, "  ").length / 2));
}

function stripEmphasis(text: string): string {
  return text.replace(/(\*\*|__)(.+?)\1/g, "$2");
}

/** Inline formatting outside code spans. */
function inline(text: string): string {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) => (i % 2 === 1 ? escapeText(part) : inlineText(part)))
    .join("");
}

const PLACEHOLDER = "\u0000";

function inlineText(text: string): string {
  // Links become Slack's `<url|label>`, which escaping must not touch.
  const links: string[] = [];
  const hold = (value: string): string => {
    links.push(value);

    return `${PLACEHOLDER}${links.length - 1}${PLACEHOLDER}`;
  };
  let s = text.replace(
    /!?\[([^\]]*)\]\((\S+?)(?:\s+"[^"]*")?\)/g,
    (_m, label: string, url: string) => {
      const name = escapeText(stripEmphasis(label).replace(/\|/g, "/"));

      return hold(name ? `<${escapeUrl(url)}|${name}>` : `<${escapeUrl(url)}>`);
    },
  );
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_m, url: string) =>
    hold(`<${escapeUrl(url)}>`),
  );
  s = escapeText(s);
  s = s
    .replace(
      /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g,
      `${PLACEHOLDER}B$2${PLACEHOLDER}B`,
    )
    .replace(/(^|[^\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?!\w)/g, "$1_$2_")
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "~$1~")
    .replace(new RegExp(`${PLACEHOLDER}B`, "g"), "*");

  return s.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g"),
    (_m, i: string) => links[Number(i)] ?? "",
  );
}

export function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeUrl(url: string): string {
  return url.replace(/[<>|]/g, encodeURIComponent);
}

/**
 * Cut mrkdwn to `limit` characters at a paragraph or line break, closing an
 * open code block, and say where the rest is.
 */
export function truncateMrkdwn(
  text: string,
  limit: number,
  fullUrl: string | null,
): string {
  if (text.length <= limit) {
    return text;
  }
  const more = fullUrl
    ? `\n\n…<${fullUrl}|View the full reply in Argus>`
    : "\n\n…The full reply is in Argus.";
  const budget = Math.max(0, limit - more.length - 4);
  let cut = text.slice(0, budget);
  const paragraph = cut.lastIndexOf("\n\n");
  const line = cut.lastIndexOf("\n");
  if (paragraph > budget * 0.6) {
    cut = cut.slice(0, paragraph);
  } else if (line > budget * 0.6) {
    cut = cut.slice(0, line);
  } else {
    const space = cut.lastIndexOf(" ");
    if (space > budget * 0.8) {
      cut = cut.slice(0, space);
    }
  }
  // An odd number of fences leaves a code block open.
  if ((cut.match(/```/g)?.length ?? 0) % 2 === 1) {
    cut += "\n```";
  }

  return `${cut.trimEnd()}${more}`;
}
