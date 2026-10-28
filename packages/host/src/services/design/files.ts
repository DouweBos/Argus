/**
 * A session's design references as files in its worktree, so agents and
 * conductor's `assert-screenshot` can work from them like any other file.
 * Kept out of git through the repo's `info/exclude`.
 */

import type { DesignRef } from "@argus/remote-protocol";
import { DESIGN_DIR, designFileStem } from "@argus/remote-protocol";
import fs from "node:fs/promises";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { exportableNodes, flattenLayers } from "../integrations/figma/layers";
import { parseFigmaUrl } from "../integrations/figma/refs";
import {
  figmaApi,
  figmaDesignContext,
  withFigma,
} from "../integrations/figma/service";
import { git } from "../session/git";

/** Renders at 3x: the scale of most current phones, so the files read crisp. */
const REFERENCE_SCALE = 3;

async function excludeFromGit(worktree: string): Promise<void> {
  const common = (
    await git(worktree, ["rev-parse", "--git-common-dir"])
  ).trim();
  const exclude = path.resolve(worktree, common, "info", "exclude");
  const line = `/${DESIGN_DIR}/`;
  const current = await fs.readFile(exclude, "utf8").catch(() => "");
  if (!current.split("\n").includes(line)) {
    await fs.mkdir(path.dirname(exclude), { recursive: true });
    await fs.appendFile(
      exclude,
      `${current.endsWith("\n") || !current ? "" : "\n"}${line}\n`,
    );
  }
}

/** Writes `<stem>.png` and `<stem>.json` per reference. Best-effort per frame. */
export async function writeDesignFiles(
  worktree: string,
  refs: DesignRef[],
): Promise<void> {
  if (refs.length === 0 || !worktree || !figmaApi()) {
    return;
  }
  const dir = path.join(worktree, DESIGN_DIR);
  await fs.mkdir(dir, { recursive: true });
  await excludeFromGit(worktree).catch((err: unknown) =>
    warn(`[design] couldn't keep ${DESIGN_DIR} out of git: ${String(err)}`),
  );
  await Promise.all(
    refs.map(async (ref) => {
      try {
        const stem = designFileStem(ref);
        const [rendered, context] = await Promise.all([
          withFigma((api) =>
            api.frame(ref.fileKey, ref.nodeId, REFERENCE_SCALE),
          ),
          figmaDesignContext(ref.url),
        ]);
        if (rendered) {
          await fs.writeFile(
            path.join(dir, `${stem}.png`),
            Buffer.from(rendered.image, "base64"),
          );
        }
        await fs.writeFile(
          path.join(dir, `${stem}.json`),
          JSON.stringify(
            {
              name: ref.name,
              url: ref.url,
              version: ref.version ?? null,
              size: rendered
                ? { width: rendered.width, height: rendered.height }
                : null,
              scale: REFERENCE_SCALE,
              comments: context?.comments ?? [],
              layers: context?.node ? flattenLayers(context.node) : [],
            },
            null,
            2,
          ),
        );
      } catch (err) {
        warn(
          `[design] couldn't write the reference for ${ref.name}: ${String(err)}`,
        );
      }
    }),
  );
}

/** Exports the frame's icons and small images into the worktree; returns their paths. */
export async function exportDesignAssets(
  worktree: string,
  url: string,
  format: "png" | "svg",
): Promise<string[]> {
  const ref = parseFigmaUrl(url);
  const context = ref ? await figmaDesignContext(url) : null;
  if (!ref || !context?.node) {
    throw `"${url}" isn't a Figma frame Argus can read.`;
  }
  const nodes = exportableNodes(context.node);
  const urls = await withFigma((api) =>
    api.exportUrls(
      ref.fileKey,
      nodes.map((n) => n.id),
      format,
    ),
  );
  const dir = path.join(worktree, DESIGN_DIR, "assets");
  await fs.mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const node of nodes) {
    const source = urls[node.id];
    if (!source) {
      continue;
    }
    const res = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      continue;
    }
    const name = `${
      node.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "asset"
    }-${node.id.replace(/[^0-9a-z]+/gi, "-")}.${format}`;
    const file = path.join(dir, name);
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    written.push(path.relative(worktree, file));
  }

  return written;
}

/** Keeps the last comparison per frame next to the reference, for review. */
export async function saveComparison(
  worktree: string,
  url: string,
  result: { design: string; diff: string; screenshot: string },
): Promise<string> {
  const ref = parseFigmaUrl(url);
  const stem = designFileStem({
    url,
    fileKey: ref?.fileKey ?? "",
    nodeId: ref?.nodeId ?? null,
    name: "compare",
  });
  const dir = path.join(worktree, DESIGN_DIR, "compare");
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(dir, `${stem}-screen.png`),
      Buffer.from(result.screenshot, "base64"),
    ),
    fs.writeFile(
      path.join(dir, `${stem}-diff.png`),
      Buffer.from(result.diff, "base64"),
    ),
  ]);

  return path.join(DESIGN_DIR, "compare", `${stem}-{screen,diff}.png`);
}
