// Swift UI rules `pnpm lint` can't otherwise see: system styles that ignore
// the theme and draw in macOS's blue, or the window's near-black.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "clients", "apple");
const SKIP = new Set([".build", ".swiftpm", "DerivedData", "Generated"]);
const RULES = [
  {
    pattern: /\.buttonStyle\(\.link\)/,
    message: "use .buttonStyle(.accentLink) — .link ignores the theme's accent",
  },
  {
    pattern: /\.sheet\(/,
    message:
      "use .argusSheet — a plain .sheet paints the Mac main window's near-black theme.bg behind the content",
    skip: /ArgusRemote\/|DesignSystem\/Sheet\.swift$/,
  },
];

function swiftFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) {
      return [];
    }
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return swiftFiles(full);
    }

    return name.endsWith(".swift") ? [full] : [];
  });
}

const problems = swiftFiles(ROOT).flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, i) =>
      RULES.filter(
        (rule) => rule.pattern.test(line) && !rule.skip?.test(file),
      ).map(
        (rule) =>
          `${path.relative(process.cwd(), file)}:${i + 1}: ${rule.message}`,
      ),
    ),
);

if (problems.length > 0) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}
