/**
 * Fixture scenarios: the canned backend a marketing screenshot renders against.
 *
 * A scenario is plain data — IPC replies keyed by channel, plus the
 * `localStorage` a real install would already hold. `shots/` drives the app
 * through these so every capture is byte-identical run to run.
 */

/**
 * Derives a reply from the call's args — `list_agents` is per-session. Declare
 * the parameter explicitly at the use site; a `unknown | fn` union collapses
 * back to `unknown` and loses the annotation.
 */
export type FixtureResolver = (args: Record<string, unknown>) => unknown;

/** A backend event the scenario pushes once the app has subscribed. */
export interface FixtureEvent {
  /**
   * Seconds into the scenario's story this happened: transcript timestamps
   * read from it, so a turn says "Worked for 1m 14s" rather than "0s".
   */
  at?: number;
  channel: string;
  /**
   * Extra delay before this one fires. Per-agent listeners (`agent:event:<id>`)
   * are only subscribed once `agent:started` has been processed, and `listen()`
   * resolves asynchronously — a transcript pushed in the same tick is dropped.
   */
  delayMs?: number;
  payload: unknown;
}

/** One captured beat of a recording: what changes, and the caption over it. */
export interface FixtureBeat {
  /** Agent tab to open before this frame is shot. */
  activeAgents?: Record<string, string>;
  /** Events pushed before this frame is shot. */
  events?: FixtureEvent[];
  /** How long this frame holds in the finished clip, in seconds. */
  holdSeconds?: number;
  /** Route to move to before this frame is shot. */
  route?: string;
  /**
   * Scrolls the page's tallest scrollable pane before the frame is shot. Some
   * of what sells a screen is below the fold, and a recording can go there.
   * Resolved by measurement rather than by selector, because the container is
   * a CSS-module class whose name is a build detail.
   */
  scrollTo?: number;
  /** Settings section to open before this frame is shot. */
  settingsSection?: string;
}

export interface FixtureScenario {
  /**
   * Agent to show per session. `agent:started` registers an agent but never
   * makes it active — the real app does that when you start or pick one — so a
   * transcript scenario has to say which tab is open.
   */
  activeAgents?: Record<string, string>;
  /**
   * Turns the scenario into a recording. The runner shoots a frame, calls
   * `window.__argusFixtureBeat()`, shoots the next, and stitches them with
   * ffmpeg — conductor's video capture is device-only, and a scripted sequence
   * is reproducible in a way a screen recording never is.
   */
  beats?: FixtureBeat[];
  /**
   * A still in `fixture/screens/` (`<name>@<theme>.png`) streamed as the
   * picture of whichever device the app watches: the app the agents build.
   */
  deviceScreen?: string;
  /** IPC replies by channel, canned or resolved. Overrides the shared defaults. */
  channels: Record<string, unknown>;
  /**
   * Pushed after boot: agents only reach the renderer as events locally, so a
   * scenario with running agents has to announce them.
   */
  events?: FixtureEvent[];
  /** Screenshot filename stem and `?fixture=` value. */
  id: string;
  /**
   * Which beat becomes the poster. Defaults to the last, which is wrong
   * whenever the story ends on a resolved state (an approved guest leaves an
   * empty panel) rather than the moment worth showing.
   */
  posterBeat?: number;
  /** Route to land on, e.g. `/sessions/ses_search`. */
  route?: string;
  /** Opens the settings dialog on a given section id, e.g. `remote-access`. */
  settingsSection?: string;
  /** Seeded before any store module reads it. */
  storage?: Record<string, unknown>;
}
