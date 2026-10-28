/**
 * Figma calls behind Argus's own token. Rendered frames are cached: a session
 * shows the same frame in its chip, its Design view and its agent's context.
 */

import type { DesignRef, FigmaFrame } from "@argus/remote-protocol";
import { loadIntegration, readSecret } from "../credentials";
import { credentialRejected } from "../service";
import { FigmaApi, FigmaAuthError, type TrimmedNode } from "./client";
import { parseFigmaUrl } from "./refs";

const FRAME_CACHE_LIMIT = 30;
const frameCache = new Map<string, FigmaFrame>();

export function figmaApi(): FigmaApi | null {
  const entry = loadIntegration("figma");
  if (!entry || entry.needsReauth) {
    return null;
  }
  const secret = readSecret("figma");

  return secret ? new FigmaApi(secret) : null;
}

async function withFigma<T>(fn: (api: FigmaApi) => Promise<T>): Promise<T> {
  const api = figmaApi();
  if (!api) {
    throw "Figma isn't connected. Connect it in Settings → Integrations.";
  }
  try {
    return await fn(api);
  } catch (err) {
    if (err instanceof FigmaAuthError) {
      throw credentialRejected("figma");
    }
    throw err instanceof Error ? err.message : err;
  }
}

function cacheKey(fileKey: string, nodeId: string | null): string {
  return `${fileKey}:${nodeId ?? ""}`;
}

export function figmaFrame(url: string): Promise<FigmaFrame | null> {
  const ref = parseFigmaUrl(url);
  if (!ref) {
    return Promise.resolve(null);
  }
  const key = cacheKey(ref.fileKey, ref.nodeId);
  const cached = frameCache.get(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  return withFigma(async (api) => {
    const frame = await api.frame(ref.fileKey, ref.nodeId);
    if (frame) {
      frameCache.set(key, frame);
      if (frameCache.size > FRAME_CACHE_LIMIT) {
        frameCache.delete(frameCache.keys().next().value as string);
      }
    }

    return frame;
  });
}

/** A link resolved to a named design reference, or null when it isn't Figma's. */
export async function figmaDesignRef(url: string): Promise<DesignRef | null> {
  const ref = parseFigmaUrl(url);
  if (!ref) {
    return null;
  }
  const frame = await figmaFrame(url);

  return {
    url: url.trim(),
    fileKey: ref.fileKey,
    nodeId: ref.nodeId,
    name: frame?.name ?? "Figma frame",
  };
}

export interface FigmaDesignContext {
  frame: FigmaFrame;
  node: TrimmedNode | null;
  comments: { author: string; body: string }[];
}

/** What an agent builds from: the picture, the structure, and the designer's notes. */
export async function figmaDesignContext(
  url: string,
): Promise<FigmaDesignContext | null> {
  const ref = parseFigmaUrl(url);
  if (!ref) {
    return null;
  }
  const frame = await figmaFrame(url);
  if (!frame) {
    return null;
  }
  const [node, comments] = await withFigma((api) =>
    Promise.all([
      api.node(ref.fileKey, ref.nodeId),
      api.comments(ref.fileKey, ref.nodeId).catch(() => []),
    ]),
  );

  return { frame, node, comments };
}
