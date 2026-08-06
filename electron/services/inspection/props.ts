/**
 * Read a node's React Native props from the in-process `/props` endpoint.
 *
 * Fabric converts JSX props into native `react::Props`; `/props?id=` dumps the
 * typed `ViewProps` plus the raw JS prop bag (`rawProps`) as JSON. Fetched over
 * HTTP directly (id as a query param) for the same reasons as `/inspect` and
 * `/set`: no CLI stdout truncation, no hex-id coercion.
 *
 * Degrades gracefully — an older dylib without the endpoint, or a non-Fabric
 * view, just yields no props rather than an error the panel has to handle.
 */

import { inprocGetJson, readInprocPort } from "./inproc";

export interface NodeProps {
  class?: string;
  id?: string;
  isFabric?: boolean;
  note?: string;
  props?: Record<string, unknown> | null;
  rawProps?: Record<string, unknown> | null;
  status?: string;
}

export async function getNodeProps(
  deviceKey: string,
  nodeId: string,
): Promise<NodeProps> {
  if (!deviceKey || !nodeId) {
    throw "Missing device or node.";
  }
  const port = readInprocPort(deviceKey);
  if (port === null) {
    throw "In-process server not found — relaunch the app with inspection (launch-app --inject).";
  }

  return inprocGetJson<NodeProps>(
    port,
    `/props?id=${encodeURIComponent(nodeId)}`,
  );
}
