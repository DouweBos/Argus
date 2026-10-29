/**
 * Figma's REST API. Figma ships no client SDK — only OpenAPI types — and we
 * need four endpoints, so this is plain `fetch`.
 */

import type { IntegrationAccount } from "@argus/remote-protocol";

const API = "https://api.figma.com/v1";
const MAX_NODE_DEPTH = 6;
const MAX_CHILDREN = 60;

/** The token was rejected — the caller flags the integration for reauth. */
export class FigmaAuthError extends Error {}

export interface FigmaFrame {
  name: string;
  /** PNG, base64. */
  image: string;
  width: number;
  height: number;
}

/** A node trimmed to what an agent needs to build it: layout, type, colors, text. */
export interface TrimmedNode {
  id: string;
  name: string;
  type: string;
  size?: { w: number; h: number };
  /** Top-left relative to the trimmed root. */
  at?: { x: number; y: number };
  layout?: Record<string, unknown>;
  fills?: unknown;
  strokes?: unknown;
  cornerRadius?: number;
  text?: string;
  style?: Record<string, unknown>;
  children?: TrimmedNode[];
}

interface RawNode {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  fills?: unknown[];
  strokes?: unknown[];
  cornerRadius?: number;
  characters?: string;
  style?: Record<string, unknown>;
  visible?: boolean;
  children?: RawNode[];
}

export function trimNode(
  node: RawNode,
  depth = 0,
  origin = node.absoluteBoundingBox,
): TrimmedNode {
  const trimmed: TrimmedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
  };
  const box = node.absoluteBoundingBox;
  if (box) {
    trimmed.size = { w: Math.round(box.width), h: Math.round(box.height) };
    if (origin) {
      trimmed.at = {
        x: Math.round(box.x - origin.x),
        y: Math.round(box.y - origin.y),
      };
    }
  }
  if (node.layoutMode && node.layoutMode !== "NONE") {
    trimmed.layout = {
      mode: node.layoutMode,
      gap: node.itemSpacing,
      padding: [
        node.paddingTop,
        node.paddingRight,
        node.paddingBottom,
        node.paddingLeft,
      ],
      align: [node.primaryAxisAlignItems, node.counterAxisAlignItems],
    };
  }
  if (node.fills?.length) {
    trimmed.fills = node.fills;
  }
  if (node.strokes?.length) {
    trimmed.strokes = node.strokes;
  }
  if (node.cornerRadius) {
    trimmed.cornerRadius = node.cornerRadius;
  }
  if (node.characters) {
    trimmed.text = node.characters;
    if (node.style) {
      const {
        fontFamily,
        fontWeight,
        fontSize,
        lineHeightPx,
        letterSpacing,
        textAlignHorizontal,
      } = node.style;
      trimmed.style = {
        fontFamily,
        fontWeight,
        fontSize,
        lineHeightPx,
        letterSpacing,
        textAlignHorizontal,
      };
    }
  }
  const visible = (node.children ?? []).filter((c) => c.visible !== false);
  if (visible.length > 0 && depth < MAX_NODE_DEPTH) {
    trimmed.children = visible
      .slice(0, MAX_CHILDREN)
      .map((c) => trimNode(c, depth + 1, origin));
  }

  return trimmed;
}

export interface FigmaFileOutline {
  name: string;
  version: string;
  lastModified: number;
  pages: { name: string; frames: { id: string; name: string }[] }[];
}

export class FigmaApi {
  /** A personal access token, or an OAuth access token sent as a bearer. */
  constructor(
    private readonly token: string,
    private readonly method: "key" | "oauth" = "key",
  ) {}

  private async get<T>(pathAndQuery: string): Promise<T> {
    const res = await fetch(`${API}${pathAndQuery}`, {
      headers:
        this.method === "oauth"
          ? { authorization: `Bearer ${this.token}` }
          : { "x-figma-token": this.token },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new FigmaAuthError(
        `Figma rejected the token (HTTP ${res.status}).`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Figma: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
    }

    return (await res.json()) as T;
  }

  async account(): Promise<IntegrationAccount> {
    const me = await this.get<{ handle: string; email?: string }>("/me");

    return { name: me.handle, email: me.email ?? null, workspace: null };
  }

  /** The file's first page's first frame stands in when the link names no node. */
  private async resolveNode(
    fileKey: string,
    nodeId: string | null,
  ): Promise<string> {
    if (nodeId) {
      return nodeId;
    }
    const file = await this.get<{
      document: { children: { children?: { id: string }[] }[] };
    }>(`/files/${fileKey}?depth=2`);
    const first = file.document.children[0]?.children?.[0]?.id;
    if (!first) {
      throw new Error("That Figma file has no frames.");
    }

    return first;
  }

  async node(
    fileKey: string,
    nodeId: string | null,
  ): Promise<TrimmedNode | null> {
    const id = await this.resolveNode(fileKey, nodeId);
    const data = await this.get<{
      nodes: Record<string, { document: RawNode } | null>;
    }>(`/files/${fileKey}/nodes?ids=${encodeURIComponent(id)}`);
    const doc = data.nodes[id]?.document;

    return doc ? trimNode(doc) : null;
  }

  async frame(
    fileKey: string,
    nodeId: string | null,
    scale = 2,
  ): Promise<FigmaFrame | null> {
    const id = await this.resolveNode(fileKey, nodeId);
    const [nodes, images] = await Promise.all([
      this.get<{ nodes: Record<string, { document: RawNode } | null> }>(
        `/files/${fileKey}/nodes?ids=${encodeURIComponent(id)}&depth=1`,
      ),
      this.get<{ images: Record<string, string | null> }>(
        `/images/${fileKey}?ids=${encodeURIComponent(id)}&format=png&scale=${scale}&use_absolute_bounds=true`,
      ),
    ]);
    const doc = nodes.nodes[id]?.document;
    const imageUrl = images.images[id];
    if (!doc || !imageUrl) {
      return null;
    }
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(
        `Figma: the rendered frame didn't download (HTTP ${res.status}).`,
      );
    }

    return {
      name: doc.name,
      image: Buffer.from(await res.arrayBuffer()).toString("base64"),
      width: Math.round(doc.absoluteBoundingBox?.width ?? 0),
      height: Math.round(doc.absoluteBoundingBox?.height ?? 0),
    };
  }

  /** Open comments pinned to the node, oldest first. */
  async comments(
    fileKey: string,
    nodeId: string | null,
  ): Promise<{ author: string; body: string }[]> {
    const data = await this.get<{
      comments: {
        message: string;
        resolved_at: string | null;
        user: { handle: string };
        client_meta?: { node_id?: string } | null;
        created_at: string;
      }[];
    }>(`/files/${fileKey}/comments`);

    return data.comments
      .filter(
        (c) => !c.resolved_at && (!nodeId || c.client_meta?.node_id === nodeId),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((c) => ({ author: c.user.handle, body: c.message }));
  }

  /** File name, version, and each page's top-level frames. */
  async outline(fileKey: string): Promise<FigmaFileOutline> {
    const file = await this.get<{
      name: string;
      version: string;
      lastModified: string;
      document: {
        children: {
          name: string;
          children?: { id: string; name: string; type: string }[];
        }[];
      };
    }>(`/files/${fileKey}?depth=2`);

    return {
      name: file.name,
      version: file.version,
      lastModified: Date.parse(file.lastModified),
      pages: file.document.children.map((page) => ({
        name: page.name,
        frames: (page.children ?? [])
          .filter((c) =>
            ["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION"].includes(c.type),
          )
          .map((c) => ({ id: c.id, name: c.name })),
      })),
    };
  }

  /** Download URLs for rendering nodes, keyed by node id (missing ones are left out). */
  async exportUrls(
    fileKey: string,
    ids: string[],
    format: "png" | "svg",
    scale = 3,
  ): Promise<Record<string, string>> {
    if (ids.length === 0) {
      return {};
    }
    const scaleParam = format === "png" ? `&scale=${scale}` : "";
    const data = await this.get<{ images: Record<string, string | null> }>(
      `/images/${fileKey}?ids=${encodeURIComponent(ids.join(","))}&format=${format}${scaleParam}`,
    );

    return Object.fromEntries(
      Object.entries(data.images).filter((e): e is [string, string] =>
        Boolean(e[1]),
      ),
    );
  }
}
