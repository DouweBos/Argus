# Host-owned conversations

Make the Node host (`packages/host`) the only writer of an agent's
conversation. Every client — the Electron renderer (main window and popouts),
the native Mac app, the iOS app and the embedded web client — becomes a viewer:
it loads the newest page, pages older history on scroll-up, and applies a live
delta the host pushes. Nothing pushes or pulls a full-history snapshot per
update any more.

## Today: three writers

The reducer itself is already shared (`packages/host/src/services/agent/conversation/reducer.ts`,
ported to Swift as `ConversationReducer`). What is duplicated is everything
around it.

| Responsibility                               | Host driver (`hostDriver.ts`)                   | Electron renderer (`agentEventService.ts` + `conversationStore`) | Mac (`ArgusCore/Live/LiveAgents*`)                                |
| -------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Active when                                  | nobody claims (`claimConversations`)            | main window alive (`electron/main.ts` claims for its lifetime)   | local socket connected (`localUiSocket.ts` claims per connection) |
| Fold stream / stderr / mcp / remote messages | yes                                             | yes, per window (popouts run a second copy)                      | yes                                                               |
| Publish                                      | `publish_agent_snapshot`, full JSON every 50 ms | full JSON (per-message cache) every 500 ms                       | full JSON per 500 ms debounce                                     |
| Save history                                 | whole file every 500 ms                         | at most every 10 s + turn end                                    | debounce 500 ms                                                   |
| Queue drain + checkpoint                     | yes                                             | yes (per window)                                                 | yes                                                               |
| Title, notify                                | yes (phone only)                                | yes (`showLocal` when unfocused)                                 | yes (`showLocal` when unfocused)                                  |
| Readers                                      | —                                               | popouts hydrate via `get_agent_snapshot`                         | —                                                                 |

Readers of the snapshot string (`appState.agentSnapshots`): gateway
`agents.transcript`/`agents.image`, `agent.status` title/awaiting, MCP
`read_agent_transcript`, the tray label.

iOS and the web client are viewers already: `agents.transcript` (80 per page,
cursors over the raw message array, hidden bookkeeping thins the page) and a
300 ms debounced refetch of the tail on every `agent.event`, plus a 5 s poll.
That refetch re-converts and re-sends the newest 80 messages per streamed
event.

Problems this causes: one writer per claimed UI plus another per popout (double
queue drains are possible, unread/title diverge between windows); a renderer
reload loses everything until the next event; every update reserialises the
whole history (megabytes for a long chat) in some process; the Mac decodes the
whole history to open a chat; phones refetch pages per event.

## Target

The host is always the owner. `hostDriver.ts` grows into the single
conversation service; the claim/hand-back machinery goes.

### Host

- `conversation/live.ts` — the in-memory conversations (`Map<agentId, Live>`),
  each with an `epoch` (random id minted when the host starts tracking it, or
  re-seeds it) and a `revision` (bumped per emitted delta). Replaces
  `appState.agentSnapshots`.
- `conversation/delta.ts` — pure diff between the last emitted conversation and
  the current one. The reducer is immutable with structural sharing, so a
  changed message is a new object: diffing is a reference walk, no
  serialisation.
- `conversation/driver.ts` — the event routing that is `hostDriver.ts` today,
  always on.
- `conversation/persistence.ts` — chat history saves: on turn end, exit, stop,
  shutdown, and at most every 10 s mid-turn (the renderer's cadence; today the
  host driver rewrites the whole file every 500 ms). Same `SavedConversation`
  JSON as today, so existing files and resume are untouched.
- Notifications decide `showLocal` from `hostPlatform().isForeground()`
  (Electron: window focus; Mac: `ui.state`), replacing the renderer's and the
  Mac's copies.
- User sends from every client go through one host path
  (`submitAgentMessage`): queue-or-send, checkpoint, user bubble, title. The
  gateway's `agents.send` already makes this decision; it becomes a caller.

### Protocol

Live delta, bus channel `agent:transcript:<agentId>` (renderer, popouts, remote
desktops via `ipc`), raw `ConversationMessage` form:

```ts
AgentTranscriptDelta = {
  agentId: string;
  epoch: string;
  revision: number;          // previous + 1 within an epoch
  total: number;             // raw message count afterwards
  ops: (
    | { op: "append"; index: number; message: ConversationMessage }
    | { op: "update"; index: number; message: ConversationMessage }
    | { op: "remove"; index: number; id: string }   // from the end, after a rewind/clear
  )[];
  meta?: Partial<AgentConversationMeta>;            // changed fields only; null clears
}
```

`AgentConversationMeta` is `AgentConversation` minus `messages`, plus
`firstUserText` (title fallback when the first message isn't loaded) and
`runningSubagents` (today derived by scanning the whole history).

Typed gateway event `agent.transcript` (iOS, Mac, web), `RemoteMessage` form,
built once per delta and shared by every subscribed connection:

```ts
{
  agent_id, epoch, revision, total,
  messages: RemoteMessage[],   // upserted, in order; unknown ids append
  removed_ids: string[],       // removed, or now hidden by the visibility rules
  // present only when changed; null clears
  title?, model?, pending_tool_name?, tasks?, todos?
}
```

Image refs stay `messageId:slot:index` and resolve lazily through
`agents.image`; the host now walks the live conversation instead of a parsed
snapshot.

Commands (catalog, `pnpm gen:protocol`):

| Command                                                                                | Purpose                                                                                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `get_agent_transcript {agentId, before?, limit?}`                                      | Raw page for desktop viewers: `{epoch, revision, total, start, messages, meta}`                                       |
| `submit_agent_message {agentId, text, displayText?, images?, author?}`                 | Queue-or-send with checkpoint and bubble; returns `{queued}`                                                          |
| `rewind_agent {agentId, messageId, resend?}`                                           | Edit-and-resend / checkpoint restore: host truncates, clears the queue, `restoreAgentAtTurn`, optionally sends        |
| `agent_fork_point {agentId, messageId}`                                                | `{turnNumber, timestampMs, claudeSessionId, replayOps, model, title}` — fork needs the whole history; the host has it |
| `start_agent` + `seedFrom {agentId, throughMessageId}`                                 | Fork seeds the new agent's conversation host-side                                                                     |
| `set_agent_title`, `dismiss_agent_list {list: todos\|tasks}`, `clear_agent_transcript` | Renderer-only mutations today; now host state every client sees                                                       |

`agents.transcript` results gain optional `epoch` and `revision` so a phone
can line its page up with deltas.

### Clients

A viewer keeps `{epoch, revision, start, total, messages}` per agent:

1. Open: fetch the tail page. While it is in flight, buffer deltas; replay
   those newer than the page's revision.
2. Delta: same epoch and `revision === known + 1` → apply. Older or equal →
   drop. Anything else (gap, new epoch, unknown agent) → refetch the tail.
3. Scroll-up: `before: start`.
4. Reconnect: refetch.

- **Electron renderer**: `conversationStore` becomes this window cache (the
  `AgentConversation` shape stays, `messages` is the loaded slice, so
  components barely change). Unread markers, drafts, pending images, tool
  drafts and scroll windowing stay renderer view state. Popouts hydrate the
  same way as the main window. Edit/restore/fork/rename/dismiss/clear call the
  host commands above.
- **Mac**: `HostStore` drops `LiveAgents` and takes the iOS path, plus deltas.
  Views that read `live` (session agent list, subagent indicator, huddles,
  quit save) read `statusByAgent`/transcript meta instead. Saved-chat preview
  uses `agents.stopped_transcript` paging rather than decoding the whole file.
- **iOS / web client**: apply `agent.transcript`; keep the debounced refetch
  only as the gap path and for hosts that never send a delta (older hosts).

## Migration order

Each step leaves every client working.

1. Host + protocol: live conversation service with deltas, always-on driver,
   new commands and events, `agents.transcript`/`agents.image`/MCP/tray read
   the live conversation. Claims still make the host stand down, and while one
   is held those readers fall back to the published snapshot, so the old
   owners keep working untouched.
2. Electron renderer → viewer. Drop the main-window claim.
3. Mac → viewer. Drop the local-socket claim.
4. iOS + web → deltas.
5. Delete the dead owners: claim machinery and the snapshot fallback, `agentEventService`
   owner paths, `conversationSnapshot.ts`, `agentNotifications.ts`,
   `LiveAgents*`, the Swift reducer and `RemoteTranscriptBuilder` if unused,
   `appState.agentSnapshots`.

## Compatibility

- **Chat history files**: format unchanged (`SavedConversation`, schema 1);
  resume still seeds from `loadConversationByRunnerSession` with
  `resuming: true`.
- **Older desktops on a newer host** (remote Electron over `ipc`):
  `publish_agent_snapshot` is accepted and ignored; `get_agent_snapshot`
  serialises the live conversation on demand; `save_chat_history` for an
  agent the host is tracking is ignored, so a stale client can't clobber the
  host's record. Their own folding keeps working from the raw `agent:*`
  channels they already get.
- **Newer clients on an older host**: an unknown command (`not_found` /
  `capability_denied`) makes the renderer fall back to `get_agent_snapshot` +
  refetch on `agent:event`, and sends to `agents.send`. Phones never get an
  `agent.transcript` from an old host and keep refetching on `agent.event`.
- Unknown events are already ignored by every client.

## Risks

- **Ordering**: deltas ride the same bus as `agent:event`, so per-agent order
  holds; the revision check catches anything lost (gateway drops, a sink that
  throws).
- **Reconnect / host restart**: a new epoch forces a refetch.
- **Multiple windows / popouts**: all viewers, no writers; each applies the
  same deltas.
- **Payload size**: a large tool result (or an inline image) is re-sent each
  time its message changes; tool results land once, so this is one resend per
  change, not per token. The typed form never carries image bytes.
- **Permission prompts and running subagents** used to scan the whole history
  in the renderer; meta carries them now. A pending tool call older than the
  loaded window still has its banner because the banner reads host meta.
- **Optimistic bubbles**: the host records the user bubble before the CLI sees
  the message; clients drop their optimistic copy when the host's arrives
  (same as iOS today).

## Measurements

Synthetic fixture (never a real transcript): thousands of messages with large
tool outputs. Before/after, the same harness:

- renderer work per streamed event (fold + publish vs apply delta)
- renderer memory with the chat loaded
- time to open a long chat (renderer and Mac)
- Mac transcript layout across window widths (resize)
