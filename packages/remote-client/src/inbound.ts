import type { EventEnvelope, ResponseEnvelope } from "./envelopes";

/** An envelope the client acts on: a response or an event. */
export type InboundEnvelope = EventEnvelope | ResponseEnvelope;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isSeq = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

const isError = (v: unknown): boolean =>
  isRecord(v) && typeof v.code === "string" && typeof v.message === "string";

/**
 * Structural check of a decrypted JSON envelope. Hand-written rather than zod
 * so the web bundle stays zod-free; payloads and results are left to callers.
 */
export function parseInbound(text: string): InboundEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isSeq(value.seq)) {
    return null;
  }
  if (value.type === "res") {
    const ok =
      typeof value.id === "string" &&
      (value.error === undefined || isError(value.error));

    return ok ? (value as unknown as ResponseEnvelope) : null;
  }
  if (value.type === "evt") {
    const agentId = value.agent_id;
    const ok =
      typeof value.event === "string" &&
      (agentId === undefined ||
        agentId === null ||
        typeof agentId === "string");

    return ok ? (value as unknown as EventEnvelope) : null;
  }

  return null;
}
