# Contributing to Argus

Thanks for wanting to help. Bug reports, ideas, docs fixes and code are all welcome.

## Before you start

- **Bugs and ideas** go in [GitHub issues](https://github.com/DouweBos/Argus/issues). Search first; a
  reproduction or a screenshot goes a long way.
- **Bigger changes** (a new feature, a new protocol method, anything touching the worktree
  lifecycle) — open an issue to talk it through before writing code, so nobody's work is wasted.
- **Security issues** never go in a public issue. See [SECURITY.md](SECURITY.md).

## Setting up

You need macOS 15+ on Apple Silicon, Xcode, [mise](https://mise.jdx.dev/) and the
[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code).

```sh
mise install        # node 24, pnpm 12
pnpm install
pnpm build:bridge   # native simulator bridge
```

### Building Argus for Mac without the maintainer's Apple team

The Xcode project is signed with the maintainer's team, set in `clients/apple/Config/Argus.xcconfig`.
To use your own, create the gitignored `clients/apple/Config/Argus.local.xcconfig`:

```
DEVELOPMENT_TEAM = YOUR_TEAM_ID
```

No Apple team at all? Build ad-hoc signed from the command line:

```sh
xcodebuild -project clients/apple/ArgusRemote.xcodeproj -scheme ArgusDesktop \
  -destination 'platform=macOS' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= \
  PROVISIONING_PROFILE_SPECIFIER= CODE_SIGN_ENTITLEMENTS= \
  build
```

An ad-hoc build runs locally, without the features that need a provisioned entitlement (Sign in
with Apple, push notifications). A Debug build ("Argus Dev") keeps its state in `~/.argus-mac-dev`, apart
from an installed Argus.

The iOS simulator bridge uses Apple's private CoreSimulator and SimulatorKit frameworks, so it can
break with a new Xcode release.

## Making a change

`CLAUDE.md` is the map of the codebase and the source of truth for conventions. It's written for
coding agents, and it works just as well for humans. The short version:

- **UI comes from Peacock** (`packages/peacock`): tokens only, no hardcoded colors, no inline `<svg>`
  in client code, every component with a Storybook story.
- **`packages/host` is plain Node** and never imports a desktop shell.
- **New commands** follow the command contract in `CLAUDE.md`, then `pnpm gen:protocol`.
- **Desktop features land in Argus for Mac and the iPhone client in the same PR.**
- **Keep files focused**: ~500 lines per module, ~300 per component.

### Checks

```sh
pnpm lint      # tsc, eslint, prettier, protocol drift
pnpm test      # vitest
swift test     # inside clients/apple/{ArgusKit,ArgusCore,ArgusUI}
```

`pnpm lint` doesn't see Swift. If you touched `clients/apple`, build the affected scheme too.

### Commits and changesets

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, lower case,
  one short sentence, no trailing period. Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`,
  `build`, `chore`.
- One logical change per commit, with its tests and docs.
- User-visible changes get a changeset (`pnpm changeset`): one or two plain sentences for end users.
  `minor` for new behavior, `patch` for fixes.
- New user-facing behavior ships with its telemetry events, documented in
  [`docs/telemetry-events.md`](docs/telemetry-events.md). Never send anything a user typed or any
  names, paths or URLs.

## Pull requests

Keep PRs focused, describe what changed and why, and include a screenshot or short recording for UI
changes. CI runs lint, build and tests on every PR.

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE), and
that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
