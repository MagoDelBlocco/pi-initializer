import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	BUNDLED_PROMPT_PATH,
	buildPrompt,
	loadPromptFile,
	parseSections,
	PROMPT_PATH_ENV,
	renderTemplate,
	resolvePromptPath,
	type PromptVars,
} from "../src/prompt.ts";

const VARS: PromptVars = {
	CWD: "/proj",
	PROJECT_NAME: "proj",
	AGENTS_PATH: "/proj/AGENTS.md",
	AGENTS_RELPATH: "AGENTS.md",
	AGENTS_CONTENT: "# Proj\n\nbe careful",
	DATE: "2026-08-10",
};

function withTempDir<T>(fn: (dir: string) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "initializer-test-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── parseSections ──────────────────────────────────────────────────

test("parseSections splits on section markers and drops the leading comment", () => {
	const sections = parseSections(
		["<!-- docs comment -->", "<!-- @section: init -->", "make one", "", "<!-- @section: inject -->", "here it is"].join("\n"),
	);

	assert.deepEqual([...sections.keys()], ["init", "inject"]);
	assert.equal(sections.get("init"), "make one");
	assert.equal(sections.get("inject"), "here it is");
});

test("parseSections tolerates whitespace and casing in the marker", () => {
	const sections = parseSections("  <!--   @section:   INIT   -->  \nbody");
	assert.equal(sections.get("init"), "body");
});

test("parseSections treats a markerless file as a bare init prompt", () => {
	const sections = parseSections("<!-- header -->\n\njust do it");
	assert.deepEqual([...sections.entries()], [["init", "just do it"]]);
});

test("parseSections returns nothing for an empty file", () => {
	assert.equal(parseSections("   \n\n ").size, 0);
});

// ── renderTemplate ─────────────────────────────────────────────────

test("renderTemplate substitutes known placeholders", () => {
	assert.equal(
		renderTemplate("write {{AGENTS_RELPATH}} in {{CWD}} on {{DATE}}", VARS),
		"write AGENTS.md in /proj on 2026-08-10",
	);
});

test("renderTemplate leaves unknown placeholders visible", () => {
	assert.equal(renderTemplate("{{NOPE}}", VARS), "{{NOPE}}");
});

test("renderTemplate substitutes empty values", () => {
	assert.equal(renderTemplate("[{{AGENTS_CONTENT}}]", { ...VARS, AGENTS_CONTENT: "" }), "[]");
});

// ── buildPrompt ────────────────────────────────────────────────────

test("buildPrompt renders the requested section", () => {
	const loaded = { path: "p", sections: parseSections("<!-- @section: init -->\nmake {{PROJECT_NAME}}") };
	assert.equal(buildPrompt(loaded, "init", VARS), "make proj");
});

test("buildPrompt falls back from update to init", () => {
	const loaded = { path: "p", sections: parseSections("<!-- @section: init -->\nfrom scratch") };
	assert.equal(buildPrompt(loaded, "update", VARS), "from scratch");
});

test("buildPrompt falls back to a built-in inject wrapper carrying the file", () => {
	const loaded = { path: "p", sections: parseSections("<!-- @section: init -->\nx") };
	const out = buildPrompt(loaded, "inject", VARS);
	assert.match(out, /AGENTS\.md/);
	assert.match(out, /be careful/);
	assert.doesNotMatch(out, /\{\{/);
});

test("buildPrompt throws a pointed error when init is missing", () => {
	const loaded = { path: "/x/prompt.md", sections: parseSections("<!-- @section: inject -->\nonly this") };
	assert.throws(() => buildPrompt(loaded, "init", VARS), /no "init" section/);
});

// ── resolvePromptPath ──────────────────────────────────────────────

test("resolvePromptPath prefers the env override, resolved against cwd", () => {
	assert.equal(resolvePromptPath("/proj", { [PROMPT_PATH_ENV]: "/abs/p.md" }), "/abs/p.md");
	assert.equal(resolvePromptPath("/proj", { [PROMPT_PATH_ENV]: "rel/p.md" }), "/proj/rel/p.md");
});

test("resolvePromptPath prefers a project-local prompt over the bundled one", () => {
	withTempDir((dir) => {
		assert.equal(resolvePromptPath(dir, {}), BUNDLED_PROMPT_PATH);

		const local = join(dir, ".pi", "initializer.prompt.md");
		mkdirSync(join(dir, ".pi"), { recursive: true });
		writeFileSync(local, "<!-- @section: init -->\nlocal");
		assert.equal(resolvePromptPath(dir, {}), local);
	});
});

// ── the shipped prompt.md ──────────────────────────────────────────

test("the bundled prompt.md defines all three sections and renders clean", () => {
	const loaded = loadPromptFile("/nonexistent-project-dir");
	assert.equal(loaded.path, BUNDLED_PROMPT_PATH);

	for (const section of ["init", "update", "inject"] as const) {
		assert.ok(loaded.sections.get(section), `missing section: ${section}`);
		const rendered = buildPrompt(loaded, section, VARS);
		assert.doesNotMatch(rendered, /\{\{[A-Z0-9_]+\}\}/, `unsubstituted placeholder in ${section}`);
	}

	assert.match(buildPrompt(loaded, "update", VARS), /be careful/);
	assert.match(buildPrompt(loaded, "inject", VARS), /be careful/);
	assert.doesNotMatch(buildPrompt(loaded, "init", VARS), /be careful/);
});
