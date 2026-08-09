/**
 * Locating and reading the project's AGENTS.md.
 *
 * This is the programmatic check that decides which branch /init takes, so it
 * is deliberately narrow: only the project root is considered. A nested
 * `packages/foo/AGENTS.md` describes a sub-project, not this one, and treating
 * it as the root briefing would inject the wrong instructions.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/** The canonical name, used when creating the file. */
export const CANONICAL_NAME = "AGENTS.md";

/** Names accepted when looking for an existing file, compared case-insensitively. */
const ACCEPTED_NAMES = new Set(["agents.md", "agent.md"]);

export interface AgentsFile {
	/** Absolute path to the existing file. */
	path: string;
	/** Path relative to the project root — what the agent should be told. */
	relpath: string;
	/** File contents, verbatim. */
	content: string;
}

/**
 * Find an existing AGENTS.md in the project root.
 *
 * Returns null when there is no such file, and also when the file exists but
 * holds nothing but whitespace: an empty briefing is not a briefing, and the
 * user who typed /init wants one written rather than a blank file echoed back.
 */
export function findAgentsFile(cwd: string): AgentsFile | null {
	let entries: string[];
	try {
		entries = readdirSync(cwd);
	} catch {
		return null;
	}

	// Exact match first so a repo carrying both AGENTS.md and Agents.md (case
	// sensitive filesystems allow it) resolves to the canonical one.
	const candidates = entries.filter((name) => ACCEPTED_NAMES.has(name.toLowerCase()));
	const name =
		candidates.find((n) => n === CANONICAL_NAME) ??
		candidates.sort((a, b) => a.localeCompare(b))[0];
	if (!name) return null;

	const path = join(cwd, name);
	try {
		if (!statSync(path).isFile()) return null;
		const content = readFileSync(path, "utf8");
		if (!content.trim()) return null;
		return { path, relpath: name, content };
	} catch {
		return null;
	}
}

/** Where a new AGENTS.md should be written. */
export function targetAgentsPath(cwd: string): { path: string; relpath: string } {
	return { path: join(cwd, CANONICAL_NAME), relpath: CANONICAL_NAME };
}

/** Project name for the prompt — the directory name is the best guess available. */
export function projectName(cwd: string): string {
	return basename(cwd) || cwd;
}

/** Today's date as YYYY-MM-DD, for the {{DATE}} placeholder. */
export function today(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}
