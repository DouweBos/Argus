
### Minor Changes

- eb319bc: The session card on the Mac and the agent screen on iOS show the agent's MCP servers and whether each one connected, along with the Claude account it runs as.
- e2df032: Agents and commands Claude starts in the background now show that they are still running, with a live timer, and how long they took once they finish. The turn summary on the Mac also says how many are still running.
- d57839f: Switching the Claude account in a chat now moves the running conversation onto the new account. A busy agent switches as soon as its current turn ends.
- ec21488: The design viewer in the Mac and iOS apps lets you select layers: click one on the frame or in the layer tree to outline it, see its position, size, fill, font and text, and fold groups in the tree.
- 3ac31a4: When a chat hits your Claude plan's usage limit, it now offers your other signed-in accounts that still have usage left, so you can continue on one of them with a click. Argus never switches accounts on its own.
- 8470213: Right-click an agent tab in the Mac app to rename it, copy its ID, stop it, reveal its session in Finder, or close it, the others, those to either side, the idle ones or all of them.
- 7dc99f4: The Mac app's new-agent composer lets you start in the current checkout or a new worktree off a base branch, shows the branch and its open pull request, lets you switch project from the title, and its model pill names the model it will run.
- 2b1182f: Resting the pointer on a session in the Mac sidebar shows a card with its branch, changes, upstream state and agent activity.
- 61d8ed4: Starting an agent from the Mac app or your phone is as instant as on the desktop: Argus keeps an agent warmed up for the session you're looking at, on whichever device you're looking from.
- 7746acf: Settings has a Warm agents option: keep none, one or two agents started for the sessions you're looking at, trading memory for instant starts.

### Patch Changes

- 9d18850: On the Mac, "Attached to" moves out of the toolbar into a small link icon at the foot of the sidebar.
- 1dfceb5: Figma links to a branch now open the branch's version of the frame instead of the main file's.
- 1d9d12e: The "Attached to" badge in the Mac toolbar no longer sits inside a second background.
- d56e256: The Mac app and phone no longer show the desktop window's background spare agent as an empty chat, so a prompt typed there can't vanish.
- 73c26cd: The Issues toolbar on the Mac draws its scope and layout switches without a doubled background, and you pick the project when you start an agent on an issue instead of in the toolbar.
- e96f9b7: ⌘W in the Mac app no longer closes the whole window when there is no agent or tab left to close.
- 0a2a454: The Mac app now asks before ⌘W closes an agent tab, since closing it stops the agent.
- b2f9513: A new agent's tab in the Mac app no longer disappears when you start another agent.
- 96cfc9e: The Mac app no longer cuts off the agent's working indicator, or a queued first message, at the foot of a new chat.
- db19fdc: Toggling a linked project, or any option that keeps its menu open, no longer freezes the Mac app.
- 1ae2d52: The plan review buttons sit in a single row, and stack into a column only when there isn't room.
- 0d75df5: Approving a plan in a new session starts that session and its agent again, instead of only opening the project with the plan filled in.
- 0125d4a: The full plan view on the Mac opens at a readable size instead of a narrow strip.
- 4183fbc: The running indicator in a project's sidebar header sits next to its branch name again.
- a9fdcdf: The agent status dot no longer bounces around while the agent is working or waiting for permission.
- 625cb98: The Add Project sheet on the Mac opens tall enough to review the suggested project setup without cramped scrolling.
- a50b5f2: A chat started in the Mac app from an empty agent tab the desktop window had warmed up is now saved to Recent Chats, and is no longer stopped when the desktop window navigates away.
- Updated dependencies [e2df032]
  - @argus/peacock@0.27.0

