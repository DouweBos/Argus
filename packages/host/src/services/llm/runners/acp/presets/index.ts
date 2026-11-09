import type { AcpPreset } from "../preset";
import { ANTIGRAVITY_PRESET } from "./antigravity";
import { GEMINI_PRESET } from "./gemini";
import { KIRO_PRESET } from "./kiro";

/** Every built-in ACP agent, in picker order. */
export const ACP_PRESETS: AcpPreset[] = [
  GEMINI_PRESET,
  ANTIGRAVITY_PRESET,
  KIRO_PRESET,
];
