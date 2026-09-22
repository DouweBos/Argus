
### Minor Changes

- efd8260: Automation runs now see the proposals still waiting in your inbox, so a daily run stops proposing the same thing twice: it replaces its earlier proposal instead, or withdraws it once the PR was merged or the issue closed without you. Anything a run cleared is listed in the Inbox for a day with the reason it gave.
- 591a94b: The built-in Standup digest now proposes the follow-ups it finds — a finished branch with no PR, a green PR waiting on a merge, a session that stalled — instead of only describing them. It re-proposes yesterday's rather than duplicating it, and withdraws anything that shipped overnight.

