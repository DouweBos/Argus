import type { AcpPreset } from "../preset";
import { ANTIGRAVITY_PRESET } from "./antigravity";
import { GEMINI_PRESET } from "./gemini";
import { KIRO_PRESET } from "./kiro";
import { OPENCODE_PRESET } from "./opencode";

/** Every built-in ACP agent, in picker order. */
export const ACP_PRESETS: AcpPreset[] = [
  GEMINI_PRESET,
  ANTIGRAVITY_PRESET,
  KIRO_PRESET,
  OPENCODE_PRESET,
];
