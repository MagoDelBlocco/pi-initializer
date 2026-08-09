# pi-initializer

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that adds the `/init` command:
write an `AGENTS.md` for the project you are in, or — if one already exists — load it into
context for your next message.

## What `/init` does

The branch is decided programmatically by looking for `AGENTS.md` in the project root, before
the model is involved at all.

| Situation | What happens |
| --------- | ------------ |
| No `AGENTS.md` | The initialization prompt is sent as a user message and the agent starts working: it investigates the project and writes the file. |
| `AGENTS.md` exists | Its contents are read and **queued**, not sent. Nothing is triggered — the instructions arrive alongside whatever you type next. |

The queued path uses pi's `deliverAs: "nextTurn"` delivery, so `/init` on an existing project
costs you nothing: no turn, no interruption, no round trip. You type `/init`, then type your
actual request, and the agent receives both together.

An `AGENTS.md` that exists but contains only whitespace counts as absent — you get one written
rather than a blank file echoed back.

## Usage

```
/init            # auto: write the file, or load it if it is already there
/init force      # revise the existing AGENTS.md instead of loading it
/init inject     # load the existing AGENTS.md (error if there is none)
/init status     # show which branch would run, and which prompt file is active
```

Aliases: `update` / `refresh` / `regenerate` → `force`; `reload` / `context` → `inject`;
`show` → `status`. A leading `--` is accepted (`/init --force`).

If the agent is mid-stream when you run `/init` on a project with no `AGENTS.md`, the prompt is
queued as a follow-up rather than steering the current work — analysing a whole project is not a
mid-course correction.

## Configuring the prompts

Everything the agent is told lives in [`prompt.md`](prompt.md), re-read on every `/init`, so an
edit takes effect on the next invocation without restarting pi.

The file is split into three sections by `<!-- @section: name -->` markers:

| Section | Used when |
| ------- | --------- |
| `init` | No `AGENTS.md` — asks the agent to investigate and write one. |
| `update` | `/init force` on an existing file — asks it to verify, fill gaps, and cut. Falls back to `init` if absent. |
| `inject` | An `AGENTS.md` exists — the wrapper around its contents. Has a built-in fallback. |

Placeholders substituted before sending:

| Placeholder | Value |
| ----------- | ----- |
| `{{CWD}}` | absolute path of the project root |
| `{{PROJECT_NAME}}` | basename of the project root |
| `{{AGENTS_PATH}}` | absolute path of the `AGENTS.md` to write or read |
| `{{AGENTS_RELPATH}}` | that path relative to the project root |
| `{{AGENTS_CONTENT}}` | current contents of `AGENTS.md` (empty when absent) |
| `{{DATE}}` | today's date, `YYYY-MM-DD` |

An unknown placeholder is left in the text verbatim rather than blanked, so a typo shows up in
the prompt instead of turning into a silent hole.

A `prompt.md` with no section markers is treated as a single `init` prompt — paste in your own
and it works.

### Where `prompt.md` is read from

Most specific first:

1. `$PI_INITIALIZER_PROMPT` — absolute, or relative to the project root
2. `<project>/.pi/initializer.prompt.md` — per-project override
3. the `prompt.md` bundled with this extension

`/init status` prints the one currently in effect.

## What the shipped prompt asks for

The bundled `init` prompt is built around one idea: `AGENTS.md` is loaded into context on every
session, so every line spends a budget that belongs to the actual work. It tells the agent to

- **investigate first** — manifests, CI configuration, tool configs, existing docs and rival
  agent-instruction files (`CLAUDE.md`, `.cursorrules`, …), the source tree, and recent history —
  before writing a line;
- **source every command** from a manifest, CI config, or documented script, never inventing a
  flag, and never running builds, installs, or anything that mutates the working tree;
- **write five sections** — orientation, commands (including how to run a *single* test),
  architecture as a mental model rather than a directory dump, conventions actually observed in
  the code, and gotchas — dropping any it has nothing concrete to say under;
- **stay short** — roughly 40–120 lines, readable in two minutes;
- **hedge rather than guess**, and never copy secrets into the file.

The `update` prompt inverts the emphasis: verify what is already there against the repository as
it stands, since a stale `AGENTS.md` is trusted exactly as much as a fresh one.

## Installation

Extensions in `~/.pi/agent/extensions/*/index.ts` are auto-discovered, so cloning this directory
there is all that is needed. Verify with:

```
pi list
# or
echo '{"type":"get_commands"}' | pi --mode rpc --no-session
```

## Development

```
npm install
npm test        # node:test via tsx
npm run typecheck
```

The pure logic — prompt parsing, `AGENTS.md` discovery, argument parsing — lives in `src/` free
of `pi-tui` / `pi-coding-agent` imports, so it is testable outside pi's module loader.
`index.ts` holds only the wiring.

## License

MIT
