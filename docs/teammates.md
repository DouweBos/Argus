# Teammates — agents that stay

An [automation](./automations.md) is a trigger and a playbook: it wakes up,
does its run, and is gone. A **teammate** is a named agent that stays around.
It has:

- **A name and a face** — a handle like `@ci-fixer`, a colour and a symbol.
- **A soul** — a short persona in Markdown, written by you: who it is, what it
  cares about, how it works. Every duty and conversation starts from it.
- **One memory** — the same `MEMORY.md` index and files automations keep, but
  shared by everything the teammate does. What a nightly duty learns, the
  conversation knows the next morning, and the other way round.
- **Duties** — ordinary automations it owns, each on its own trigger:
  schedule, signal, webhook or Slack.
- **Conversations** — talk to it directly, on the Mac or the phone,
  and come back to the same conversation later.

Teammates live at **`/teammates`**.

---

## Starting one

**New Teammate** opens a gallery of starting teammates — CI Fixer, PR
Reviewer, Issue Triager, Dependency Bumper, Release Notes Writer, Flaky Test
Hunter, Standup Prep, Branch Janitor. Pick one, choose the projects it looks
after, and it is created with its soul and its duties.

**Every teammate starts paused**, for the same reason every built-in
automation does: an agent that acts unprompted must be a deliberate choice.
Read its duties, then turn it on. A duty that reuses a built-in automation's
playbook keeps taking that playbook's improvements until you edit it.

An automation you already have can become a teammate's duty: **Move to
Teammate** on its screen, into a new teammate named after it or into one you
have. Its memories move into the teammate's; a name that is already taken
keeps both, the moved one with a suffix.

---

## Talking to it

A teammate's page opens on its newest conversation. Each conversation is one
agent in a folder of its own under the teammate, with the soul, the memory
index, the projects it looks after, its autonomy and a line per recent duty
run in its instructions — so "what did you find this morning?" works.

A conversation outlives the app. An idle one is paused like any other agent
and wakes on your next message; after a restart it picks the same
conversation back up from disk under the same agent id. **New Conversation**
starts a clean one; **Archive** stops one and takes it out of the list.

Tell it to remember something and it saves a memory. Its memory page lists
them: read, edit, delete or add your own.

---

## From Slack

With [Slack connected](./integrations.md#slack), start a message to Argus
with the teammate's handle — `@Argus @ci-fixer why is main red?` — and the
Slack thread becomes a conversation with it. It answers in the thread under
its name, and the conversation is also listed on its page here.

---

## From Linear

With [Linear connected](./integrations.md#connecting-linear), mention a
teammate in one of your own comments — `@ci-fixer why does login fail?` — and
within a couple of minutes it answers as a reply on that comment. Replies in
the same comment thread continue the same conversation, which is also listed
on its page here.

Only comments you wrote count: someone else's comment never instructs your
teammates. Argus polls rather than receiving webhooks, so nothing needs to be
reachable from the internet.

---

## How far it may go

A teammate's **autonomy** is a ceiling over everything it does. A duty runs at
the lowest of the app default, the teammate's autonomy, the duty's own and the
project's ceiling — the same [ladder](./automations.md#the-autonomy-ladder),
enforced in the same places. A conversation runs at the teammate's own rung:
at **Propose** it can read the projects, answer and remember, and it is
refused anything that edits, starts a session or publishes.

A project can turn a teammate off by listing its handle under
`automations.disabled` in `.argus.json`; its duties then drop to Propose in
that repository.

The teammate's switch is its duties' switch. Conversations keep working while
it is paused.

---

## Limits

| What                     | Limit                                            |
| ------------------------ | ------------------------------------------------ |
| Memories                 | 100 files, 8,000 characters each                 |
| Memory index in a prompt | 12,000 characters; past that it is cut at a line |
| Soul                     | 6,000 characters                                 |
| Conversations kept       | 200 per teammate, archived ones dropped first    |

Near the memory cap the teammate is told to merge and prune before it adds
anything. Nothing is summarised behind your back: memories are plain files
you own.

---

## Where state lives

Under your Argus home (`~/.argus`, or `~/.argus-server` for the
[server app](./server-app.md)):

| File                           | Contents                                  |
| ------------------------------ | ----------------------------------------- |
| `teammates.json`               | The teammates themselves.                 |
| `teammate-threads.json`        | Their conversations.                      |
| `teammates/<id>/SOUL.md`       | The soul — edit it here or in any editor. |
| `teammates/<id>/memory/`       | `MEMORY.md` plus one file per memory.     |
| `teammates/<id>/threads/<id>/` | One conversation's working folder.        |

A teammate's duties stay in `automations.json`, marked with its id.
Deleting a teammate takes its soul, memory and conversations; its duties go
too, or stay behind as paused, standalone automations if you choose.

---

## From your phone

The iPhone and Android apps list teammates at the top of Automations. Talking
to one, editing its profile, soul, duties or memory, and creating one from the
gallery need the **control** grant — a conversation spends the computer's
runner. A monitor-only device sees the list, the conversations and the
memory. A huddle guest reaches none of it.
