/**
 * The one way the web client calls the host: params and result typed from the
 * `@argus/remote-protocol` catalog, so a renamed field fails to compile here
 * instead of failing quietly on the wire.
 */

import type { GatewayMethod } from "@argus/remote-protocol";
import type { ParamsOf, ResultOf } from "./protocol";

/** Anything that can carry a request — the live `Transport`, or a test double. */
export interface Requester {
  request: (method: string, params: unknown) => Promise<unknown>;
}

export interface SequencedRequester {
  sequencedRequest: (
    method: string,
    params: unknown,
  ) => Promise<{ result: unknown; seq: number }>;
}

/** `request`, plus where the answer fell among events (`Transport.sequencedRequest`). */
export function sequencedRequest<M extends GatewayMethod>(
  transport: SequencedRequester,
  method: M,
  params: ParamsOf<M>,
): Promise<{ result: ResultOf<M>; seq: number }> {
  return transport.sequencedRequest(method, params) as Promise<{
    result: ResultOf<M>;
    seq: number;
  }>;
}

export function request<M extends GatewayMethod>(
  transport: Requester,
  method: M,
  params: ParamsOf<M>,
): Promise<ResultOf<M>> {
  return transport.request(method, params) as Promise<ResultOf<M>>;
}
