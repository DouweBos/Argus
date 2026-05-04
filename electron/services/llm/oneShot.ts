/**
 * Runner-agnostic one-shot LLM facade.
 *
 * Callers that need a short, structured response from an LLM (session titles,
 * branch slugs, chat titles) go through this facade rather than calling a
 * specific runner directly. Today it delegates to the Claude Code runner;
 * future runners will plug in here.
 */

export {
  runClaudePrint,
  DEFAULT_TIMEOUT_MS,
  type RunClaudePrintOptions,
} from "./runners/claudeCode/oneShot";
