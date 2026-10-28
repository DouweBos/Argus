import { z } from "zod";
import {
  DesignRef,
  FigmaFrame,
  IntegrationId,
  IntegrationStatus,
  LinearIssue,
  LinearIssueContext,
  LinearIssueDetail,
} from "../models/integrations";
import { type CommandSpec, NoParams, Void } from "./spec";

export const INTEGRATION_COMMANDS = {
  list_integrations: {
    tier: "admin",
    params: NoParams,
    result: z.array(IntegrationStatus),
  },
  /** Validates the key against the service before saving it. */
  integration_connect_with_key: {
    tier: "admin",
    params: z.object({ id: IntegrationId, key: z.string() }),
    result: IntegrationStatus,
  },
  integration_disconnect: {
    tier: "admin",
    params: z.object({ id: IntegrationId }),
    result: Void,
  },
  /** No query: the caller's open assigned issues, most recently updated first. */
  linear_list_issues: {
    tier: "admin",
    params: z.object({
      query: z.string().nullish(),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    result: z.array(LinearIssue),
  },
  /** `ref` is an identifier (`ENG-123`) or an issue URL. Null when it isn't found. */
  linear_get_issue: {
    tier: "admin",
    params: z.object({ ref: z.string() }),
    result: LinearIssueDetail.nullable(),
  },
  /** The issue plus the context and images an agent starts from. */
  linear_issue_context: {
    tier: "admin",
    params: z.object({ ref: z.string() }),
    result: LinearIssueContext.nullable(),
  },
  /** Null when the URL isn't a Figma link. */
  figma_design_ref: {
    tier: "admin",
    params: z.object({ url: z.string() }),
    result: DesignRef.nullable(),
  },
  /** The frame rendered to PNG. Cached on the host. */
  figma_frame: {
    tier: "admin",
    params: z.object({ url: z.string() }),
    result: FigmaFrame.nullable(),
  },
  /** Base64 PNG of a local simulator or emulator; null when it can't be taken. */
  device_screenshot: {
    tier: "admin",
    params: z.object({
      platform: z.enum(["android", "ios"]),
      deviceKey: z.string(),
    }),
    result: z.string().nullable(),
  },
} as const satisfies Record<string, CommandSpec>;
