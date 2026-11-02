/**
 * The one way the web client calls the host: params and result typed from the
 * `@argus/remote-protocol` catalog, so a renamed field fails to compile here
 * instead of failing quietly on the wire.
 */

import type { GatewayMethod } from "@argus/remote-protocol";
import type { ParamsOf, ResultOf } from "./protocol";

export interface RequestOptions {
  /** Overrides the transport's timeout for this one call. */
  timeoutMs?: number;
  /** A poll or resume nobody asked for: a dropped connection isn't worth reporting. */
  background?: boolean;
}

/** Anything that can carry a request — the live `Transport`, or a test double. */
export interface Requester {
  request: (
    method: string,
    params: unknown,
    options?: { timeoutMs?: number },
  ) => Promise<unknown>;
}

export interface SequencedRequester {
  sequencedRequest: (
    method: string,
    params: unknown,
  ) => Promise<{ result: unknown; seq: number }>;
}

/** Where failed requests go: the notifications log (`stores/notifications.ts`). */
export type RequestFailureSink = (
  method: GatewayMethod,
  error: unknown,
  background: boolean,
) => void;

let failureSink: RequestFailureSink | null = null;

export function setRequestFailureSink(sink: RequestFailureSink | null): void {
  failureSink = sink;
}

function reported<T>(
  promise: Promise<T>,
  method: GatewayMethod,
  background: boolean,
): Promise<T> {
  return promise.catch((error: unknown) => {
    failureSink?.(method, error, background);
    throw error;
  });
}

/** `request`, plus where the answer fell among events (`Transport.sequencedRequest`). */
export function sequencedRequest<M extends GatewayMethod>(
  transport: SequencedRequester,
  method: M,
  params: ParamsOf<M>,
): Promise<{ result: ResultOf<M>; seq: number }> {
  return reported(
    transport.sequencedRequest(method, params) as Promise<{
      result: ResultOf<M>;
      seq: number;
    }>,
    method,
    false,
  );
}

export function request<M extends GatewayMethod>(
  transport: Requester,
  method: M,
  params: ParamsOf<M>,
  options: RequestOptions = {},
): Promise<ResultOf<M>> {
  const call =
    options.timeoutMs === undefined
      ? transport.request(method, params)
      : transport.request(method, params, { timeoutMs: options.timeoutMs });

  return reported(
    call as Promise<ResultOf<M>>,
    method,
    options.background === true,
  );
}
