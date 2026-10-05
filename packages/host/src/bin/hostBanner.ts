import { LOCAL_GATEWAY_PORT } from "../services/remote/remoteService";

/** The gateway line, or why there is none: a dead address helps nobody pair. */
export function gatewayLine(error: string | null): string {
  return error
    ? `Remote access failed to start: ${error}`
    : `Gateway: ws://127.0.0.1:${LOCAL_GATEWAY_PORT}`;
}
