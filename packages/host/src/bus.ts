/**
 * The host event bus — transport-agnostic fan-out for everything services push
 * out unprompted (agent streams, session updates, PTY data, device video).
 *
 * The core cannot know about its clients: the Mac app is reached over the local
 * UI socket and a remote client over the gateway. So services emit here, and
 * each transport registers a sink that forwards to its connections.
 */

/** Receives a copy of every host event. Must never throw. */
export type HostEventSink = (channel: string, args: unknown[]) => void;

const sinks = new Set<HostEventSink>();

/**
 * Register a sink. Returns an unsubscribe function. Sinks must never throw —
 * errors are swallowed so one misbehaving transport can't starve the others.
 */
export function addHostEventSink(sink: HostEventSink): () => void {
  sinks.add(sink);

  return () => {
    sinks.delete(sink);
  };
}

/** Publish an event to every registered transport. */
export function emitHostEvent(channel: string, ...args: unknown[]): void {
  for (const sink of sinks) {
    try {
      sink(channel, args);
    } catch {
      // A sink must not disrupt delivery to the others.
    }
  }
}

/** Test-only: drop every sink. */
export function resetHostEventSinks(): void {
  sinks.clear();
}
