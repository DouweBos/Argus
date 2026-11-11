/** Model names for Antigravity's usage records, which often carry only a numeric model id. */

/** Offline fallback; ids seen with a concrete name in the scanned history win over it. */
const KNOWN_MODEL_IDS: Record<number, string> = {
  246: "gemini-2.5-pro",
  312: "gemini-2.5-flash",
  313: "gemini-2.5-flash",
  329: "gemini-2.5-flash",
  330: "gemini-2.5-flash-lite",
  281: "claude-sonnet-4",
  282: "claude-sonnet-4",
  290: "claude-opus-4",
  291: "claude-opus-4",
  333: "claude-sonnet-4-5",
  334: "claude-sonnet-4-5",
  340: "claude-haiku-4-5",
  341: "claude-haiku-4-5",
  342: "gpt-oss-120b",
  1016: "gemini-3.1-pro",
  1018: "gemini-3-flash-preview",
  1020: "gemini-3.5-flash",
  1021: "gemini-3.1-flash-image",
  1026: "claude-opus-4-6",
  1035: "claude-sonnet-4-6",
  1036: "gemini-3.1-pro",
  1037: "gemini-3.1-pro",
  1047: "gemini-3-flash-preview",
  1050: "gemini-3.1-flash-lite",
  1071: "gemini-3.6-flash",
  1072: "gemini-3.6-flash",
  1073: "gemini-3.6-flash",
  1084: "gemini-3-flash-preview",
  1132: "gemini-3.5-flash",
  1133: "gemini-3.5-flash",
  1187: "gemini-3.5-flash",
  1196: "gemini-3.6-flash",
  1266: "gemini-3.6-flash",
  1298: "gemini-3.7-flash",
  1299: "gemini-3.7-flash",
  1300: "gemini-3.7-flash",
  1301: "gemini-3.7-flash",
  1318: "gemini-3.8-flash",
  1319: "gemini-3.8-flash",
  1320: "gemini-3.8-flash",
  1322: "gemini-3.8-flash",
  1402: "claude-opus-5-5",
  1417: "gemini-4-argon",
  1418: "gemini-4-argon",
  1419: "gemini-4-argon",
};

export const knownModelName = (id: number): string | undefined =>
  KNOWN_MODEL_IDS[id];

/** `Claude 4.5 Sonnet (Thinking)` → `claude-sonnet-4-5-thinking`; `Gemini 3.1 Pro (High)` → `gemini-3.1-pro-high`. */
export function normalizeModelName(name: string): string {
  const n = name
    .trim()
    .toLowerCase()
    .replace(/\s*\(([^)]*)\)\s*$/, "-$1")
    .replace(/\s+/g, "-");
  if (!n.startsWith("claude-")) {
    return n;
  }

  return n
    .replace(/^claude-(\d+(?:\.\d+)?)-(sonnet|opus|haiku)/, "claude-$2-$1")
    .replaceAll(".", "-");
}

/** A name a price list knows, as opposed to a routing alias or placeholder. */
export function isConcreteModel(model: string): boolean {
  return (
    /^(?:gemini-\d|claude-(?:sonnet|opus|haiku)-\d|gpt-)/.test(model) &&
    !/^gemini-3-flash-(?:agent(?:-[ab])?|[ab])$/.test(model)
  );
}

/** Effort and routing variants bill as their base model. */
export function priceableModel(model: string): string {
  if (/^gemini-3-flash-(?:agent(?:-[ab])?|[ab])$/.test(model)) {
    return "gemini-3.5-flash";
  }
  const base = model.replace(
    /-(?:extra-low|low|medium|high|tiered|control|thinking|agent)$/,
    "",
  );

  return base === "gemini-3-flash" ? "gemini-3-flash-preview" : base;
}
