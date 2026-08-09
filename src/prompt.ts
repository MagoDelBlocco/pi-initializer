/**
 * prompt.md loading, section parsing, and placeholder substitution.
 *
 * The prompts are configuration, not code: they live in a markdown file the
 * user is expected to edit, and they are re-read on every /init so an edit
 * takes effect without restarting pi. Everything here is pure except
 * `resolvePromptPath`/`loadPromptFile`, so the parsing is testable in isolation.
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The prompt.md shipped with the extension, used when nothing overrides it. */
export const BUNDLED_PROMPT_PATH = fileURLToPath(
	new URL("../prompt.md", import.meta.url),
);

/** Project-local override, checked before the bundled file. */
export const PROJECT_PROMPT_RELPATH = join(".pi", "initializer.prompt.md");

/** Environment variable holding an explicit prompt.md path. */
export const PROMPT_PATH_ENV = "PI_INITIALIZER_PROMPT";

export type SectionName = "init" | "update" | "inject";

/**
 * Last-resort wrapper for the existing-AGENTS.md branch, used only when
 * prompt.md has been reduced to a bare prompt with no section markers. The
 * `init` section has no fallback on purpose — silently substituting a
 * built-in prompt for the one the user edited would be worse than an error.
 */
const FALLBACK_INJECT = `The user ran \`/init\` and \`{{AGENTS_RELPATH}}\` already exists. Its current
contents are below, read fresh from disk. Treat them as the authoritative
project instructions for the rest of this session and follow them while working
on the request that follows. Do not act on them as a task on their own.

<agents_md path="{{AGENTS_RELPATH}}">
{{AGENTS_CONTENT}}
</agents_md>`;

const SECTION_MARKER = /^[ \t]*<!--[ \t]*@section:[ \t]*([A-Za-z0-9_-]+)[ \t]*-->[ \t]*$/;

/** An HTML comment block before the first section marker (the file's own docs). */
const LEADING_COMMENT = /^\s*<!--[\s\S]*?-->\s*/;

/**
 * A type alias rather than an interface: TypeScript only gives aliases the
 * implicit index signature that lets them satisfy `Record<string, string>`,
 * which is what `renderTemplate` takes.
 */
export type PromptVars = {
	CWD: string;
	PROJECT_NAME: string;
	AGENTS_PATH: string;
	AGENTS_RELPATH: string;
	AGENTS_CONTENT: string;
	DATE: string;
};

/**
 * Split prompt.md on its `<!-- @section: name -->` markers.
 *
 * A file with no markers is treated as a single `init` section, so someone can
 * drop in a bare prompt and have it work. Text before the first marker is
 * discarded — that is where the file's own documentation comment lives.
 */
export function parseSections(text: string): Map<string, string> {
	const sections = new Map<string, string>();
	const lines = text.split("\n");

	let current: string | null = null;
	let buffer: string[] = [];

	const flush = () => {
		if (current !== null) sections.set(current, buffer.join("\n").trim());
		buffer = [];
	};

	for (const line of lines) {
		const match = SECTION_MARKER.exec(line);
		if (match) {
			flush();
			current = match[1]!.toLowerCase();
			continue;
		}
		if (current !== null) buffer.push(line);
	}
	flush();

	if (sections.size === 0) {
		const bare = text.replace(LEADING_COMMENT, "").trim();
		if (bare) sections.set("init", bare);
	}

	return sections;
}

/**
 * Replace `{{PLACEHOLDER}}` tokens. Unknown tokens are left untouched rather
 * than blanked, so a typo in prompt.md is visible in the sent prompt instead of
 * quietly turning into a hole.
 */
export function renderTemplate(
	template: string,
	vars: Readonly<Record<string, string>>,
): string {
	return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, key: string) =>
		Object.hasOwn(vars, key) ? vars[key]! : whole,
	);
}

/**
 * Where prompt.md comes from, most specific first:
 *   1. $PI_INITIALIZER_PROMPT (absolute, or relative to cwd)
 *   2. <cwd>/.pi/initializer.prompt.md
 *   3. the prompt.md bundled with this extension
 */
export function resolvePromptPath(
	cwd: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): string {
	const override = env[PROMPT_PATH_ENV]?.trim();
	if (override) {
		return isAbsolute(override) ? override : resolve(cwd, override);
	}

	const projectLocal = join(cwd, PROJECT_PROMPT_RELPATH);
	if (existsSync(projectLocal)) return projectLocal;

	return BUNDLED_PROMPT_PATH;
}

export interface LoadedPrompts {
	path: string;
	sections: Map<string, string>;
}

/** Read and parse the active prompt.md. Throws if it is missing or empty. */
export function loadPromptFile(cwd: string): LoadedPrompts {
	const path = resolvePromptPath(cwd);
	if (!existsSync(path)) {
		throw new Error(`prompt file not found: ${path}`);
	}

	const sections = parseSections(readFileSync(path, "utf8"));
	if (sections.size === 0) {
		throw new Error(`prompt file is empty: ${path}`);
	}

	return { path, sections };
}

/**
 * Pick a section and fill in its placeholders.
 *
 * `update` falls back to `init` (generating from scratch is a reasonable
 * substitute for revising), and `inject` falls back to a built-in wrapper.
 * A missing `init` is an error the user needs to see.
 */
export function buildPrompt(
	loaded: LoadedPrompts,
	section: SectionName,
	vars: PromptVars,
): string {
	return renderTemplate(selectSection(loaded, section), vars);
}

function selectSection(loaded: LoadedPrompts, section: SectionName): string {
	const direct = loaded.sections.get(section);
	if (direct) return direct;

	if (section === "update") {
		const init = loaded.sections.get("init");
		if (init) return init;
	}
	if (section === "inject") return FALLBACK_INJECT;

	throw new Error(
		`prompt file ${loaded.path} has no "${section}" section ` +
			`(expected a line reading <!-- @section: ${section} -->)`,
	);
}
