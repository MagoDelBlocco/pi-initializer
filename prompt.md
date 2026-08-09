<!--
  initializer — prompt configuration.

  This file drives the /init command. It is split into named sections by the
  `<!-- @section: name -->` markers below. Edit freely; changes take effect on
  the next /init (the file is re-read on every invocation).

  Sections:
    init    — sent when no AGENTS.md exists. Asks the agent to write one.
    update  — sent when AGENTS.md exists and /init force was used.
    inject  — queued (not sent) when AGENTS.md exists. Rides along with the
              user's next message.

  Placeholders, substituted before sending:
    {{CWD}}              absolute path of the project root
    {{PROJECT_NAME}}     basename of the project root
    {{AGENTS_PATH}}      absolute path of the AGENTS.md to write or read
    {{AGENTS_RELPATH}}   that path relative to the project root
    {{AGENTS_CONTENT}}   current contents of AGENTS.md (empty when absent)
    {{DATE}}             today's date, YYYY-MM-DD

  A file with no section markers is treated as the `init` section alone.
-->

<!-- @section: init -->
Write an `AGENTS.md` for the project at `{{CWD}}`, saving it to `{{AGENTS_RELPATH}}`.

`AGENTS.md` is the briefing a strong engineer would want on their first day, and
that every future agent session reads before touching anything. It is loaded into
context every single time, so every line spends a budget that belongs to the
actual work. Density is the whole game.

## 1. Investigate before writing a single line

Ground every claim in something you actually read. Guessing here is worse than
omitting, because a wrong `AGENTS.md` misleads every future session silently.

- **Manifests and lockfiles** — `package.json`, `pyproject.toml`, `Cargo.toml`,
  `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, `composer.json`, `Makefile`,
  `justfile`, `Taskfile.yml`. These name the real scripts and the real toolchain.
- **CI configuration** — `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`,
  and friends. CI is the ground truth for how this project is genuinely built,
  tested, and linted, and it is usually more honest than the README.
- **Tool configs** — linter, formatter, type checker, test runner, `tsconfig.json`,
  `.editorconfig`, pre-commit hooks, container and dev-environment definitions.
- **Existing prose** — `README`, `CONTRIBUTING`, `docs/`, plus any agent
  instructions already present (`CLAUDE.md`, `.cursorrules`, `.cursor/rules/`,
  `.github/copilot-instructions.md`, `.windsurfrules`). Fold what is still true
  into `AGENTS.md` instead of leaving a second, contradictory rulebook behind.
- **The source tree itself** — map the directories and entry points, then open a
  representative handful of real source files and at least a couple of tests.
  Conventions are learned by reading code; filenames only tell you where to look.
- **Recent history** — `git log --oneline -30` and the most-churned paths show
  what this project is actually working on right now.

Go broad first, then deep on whatever turns out to be the heart of the codebase.
On a large repo, sample deliberately rather than trying to read everything.

## 2. Write the file

Use this shape, and drop any heading you have nothing concrete to say under — an
empty section is worse than a missing one:

1. **Orientation** — a short paragraph: what this project is, who or what
   consumes it, and the one thing someone must understand before changing code.
2. **Commands** — exact invocations for setup, build, run, test, lint, format,
   and type-check. Include how to run a *single* test file or test case; that is
   what an agent reaches for most and what is hardest to guess correctly. Copy
   commands verbatim from the manifest or CI. Never invent a flag.
3. **Architecture** — the mental model, not a directory dump. The main
   components, how a request (or a build, or a run) flows through them, where the
   boundaries sit, and which module owns which concern. Name real paths so the
   reader can jump straight there.
4. **Conventions** — what *this* codebase demonstrably does: module and import
   style, naming, error handling, logging, typing strictness, test layout and
   naming, and any formatting rule that is actually enforced. Skip everything a
   competent engineer already does by default.
5. **Gotchas** — the non-obvious things that cost an outsider an hour. Generated
   files that must not be hand-edited, required environment variables, services
   that must be running first, code that looks wrong but is deliberate, slow or
   flaky steps, tests needing a special flag, platform quirks.

## 3. Hold the line on quality

- Every command must trace back to a manifest, a CI config, or a documented
  script. If you cannot source one, leave it out. Cheap verification (`--help`,
  `--version`, listing available scripts) is fine; do **not** run builds, test
  suites, installs, migrations, or anything that mutates the working tree.
- Be specific. "Dependencies are wired in `src/container.ts`" earns its line;
  "follows best practices" is noise and should be deleted on sight.
- Write for someone who can read code. Point at a path instead of narrating what
  a function does, and do not paste code snippets that will drift out of date.
- No exhaustive file listings, no API reference, no changelog, no aspirations
  about how the project *should* work — only what is true today, {{DATE}}.
- Never copy secrets, tokens, or credentials into the file. Name the environment
  variable; never its value.
- Aim for something readable in about two minutes — roughly 40–120 lines. Past
  that you have stopped briefing and started documenting.
- For a monorepo or a repo with clearly separate sub-projects, keep the root file
  about the whole, and say where per-package detail lives. Recommend per-package
  `AGENTS.md` files rather than inflating the root one.
- If something is a reasonable inference rather than a verified fact, say so in
  the text. A hedge costs four words; a confident error costs an hour.

## 4. Finish

Write the file to `{{AGENTS_RELPATH}}`, then report back briefly: the sections you
wrote, anything you could not determine, and any claim you would like the user to
confirm or correct.

<!-- @section: update -->
Revise the existing `AGENTS.md` at `{{AGENTS_RELPATH}}` for the project at `{{CWD}}`.

Here is the file as it stands today:

<current_agents_md>
{{AGENTS_CONTENT}}
</current_agents_md>

Treat it as a draft by someone who knew this project well — respect its
judgement, but verify its facts. The goal is to make it true and useful again,
not to rewrite it in your own voice.

## 1. Verify what is already there

Check each concrete claim against the repository as it exists now. Commands that
no longer exist, paths that moved, tools that were swapped out, and architecture
notes describing a design that has since been refactored are the failure mode
here — a stale `AGENTS.md` is trusted just as much as a fresh one, which is
exactly what makes it expensive. Read the manifests, the CI configuration, and
the source files each claim depends on before you keep or cut it.

`git log --oneline -30` and the most-churned paths are a fast way to spot what
has drifted since the file was last touched.

## 2. Fill the real gaps

Add only what a new session would actually stumble over: commands that are
missing (especially running a single test), components or boundaries that have
appeared since, conventions the code now follows that the file never captured,
and gotchas that have bitten someone recently. Ground every addition in
something you read; never invent a flag or a script name.

## 3. Cut

Remove anything stale, anything generic enough that a competent engineer would
assume it, exhaustive listings that duplicate the file tree, and prose that
explains what a path would have shown just as well. The file should stay
readable in about two minutes — roughly 40–120 lines.

## 4. Preserve

Keep the existing voice, heading structure, and ordering unless something is
genuinely broken. Keep project-specific instructions and hard-won warnings even
when you cannot immediately confirm them — flag those for the user instead of
deleting them. Never copy secrets or credentials into the file; name the
environment variable, never its value.

## 5. Finish

Write the revised file to `{{AGENTS_RELPATH}}`, then report back briefly: what you
corrected, what you added, what you removed and why, and anything you kept but
could not verify.

<!-- @section: inject -->
The user ran `/init`, and `{{AGENTS_RELPATH}}` already exists. Its current
contents are below, read fresh from disk just now. Treat this as the
authoritative version of the project's instructions for the rest of this
session — it supersedes any earlier copy of this file already in context.

Follow it as standing instruction while you work on the request that follows.
Do not act on it as a task on its own, do not summarise it back, and do not
rewrite the file unless the user asks you to.

<agents_md path="{{AGENTS_RELPATH}}">
{{AGENTS_CONTENT}}
</agents_md>
