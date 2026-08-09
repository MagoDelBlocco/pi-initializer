import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	CANONICAL_NAME,
	findAgentsFile,
	projectName,
	targetAgentsPath,
	today,
} from "../src/agents-file.ts";
import { completeMode, parseMode } from "../src/args.ts";

function withTempDir<T>(fn: (dir: string) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "initializer-test-"));
	try {
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ── findAgentsFile ─────────────────────────────────────────────────

test("findAgentsFile returns null when the project has none", () => {
	withTempDir((dir) => {
		writeFileSync(join(dir, "README.md"), "# hi");
		assert.equal(findAgentsFile(dir), null);
	});
});

test("findAgentsFile reads AGENTS.md from the project root", () => {
	withTempDir((dir) => {
		writeFileSync(join(dir, CANONICAL_NAME), "# Rules\n\nrun the tests");
		const found = findAgentsFile(dir);
		assert.equal(found?.relpath, "AGENTS.md");
		assert.equal(found?.path, join(dir, "AGENTS.md"));
		assert.match(found!.content, /run the tests/);
	});
});

test("findAgentsFile accepts alternate casing but prefers the canonical name", () => {
	withTempDir((dir) => {
		writeFileSync(join(dir, "Agents.md"), "lower");
		assert.equal(findAgentsFile(dir)?.relpath, "Agents.md");

		writeFileSync(join(dir, CANONICAL_NAME), "canonical");
		assert.equal(findAgentsFile(dir)?.relpath, "AGENTS.md");
	});
});

test("findAgentsFile treats a whitespace-only file as absent", () => {
	withTempDir((dir) => {
		writeFileSync(join(dir, CANONICAL_NAME), "\n\n   \n");
		assert.equal(findAgentsFile(dir), null);
	});
});

test("findAgentsFile ignores a nested AGENTS.md and a directory of that name", () => {
	withTempDir((dir) => {
		mkdirSync(join(dir, "packages", "web"), { recursive: true });
		writeFileSync(join(dir, "packages", "web", CANONICAL_NAME), "sub-project");
		assert.equal(findAgentsFile(dir), null);

		mkdirSync(join(dir, CANONICAL_NAME));
		assert.equal(findAgentsFile(dir), null);
	});
});

test("findAgentsFile returns null for an unreadable directory", () => {
	assert.equal(findAgentsFile("/definitely/not/a/real/path"), null);
});

// ── small helpers ──────────────────────────────────────────────────

test("targetAgentsPath points at the canonical name in the project root", () => {
	assert.deepEqual(targetAgentsPath("/proj"), {
		path: "/proj/AGENTS.md",
		relpath: "AGENTS.md",
	});
});

test("projectName uses the directory name", () => {
	assert.equal(projectName("/a/b/my-app"), "my-app");
	assert.equal(projectName("/"), "/");
});

test("today formats as YYYY-MM-DD", () => {
	assert.equal(today(new Date("2026-08-10T23:30:00Z")), "2026-08-10");
});

// ── argument parsing ───────────────────────────────────────────────

test("parseMode maps aliases and rejects unknown arguments", () => {
	assert.equal(parseMode(""), "auto");
	assert.equal(parseMode("   "), "auto");
	assert.equal(parseMode("force"), "force");
	assert.equal(parseMode("--force"), "force");
	assert.equal(parseMode("Update"), "force");
	assert.equal(parseMode("reload"), "inject");
	assert.equal(parseMode("show"), "status");
	assert.equal(parseMode("nonsense"), null);
});

test("completeMode filters by prefix and returns null when nothing matches", () => {
	assert.deepEqual(
		completeMode("f")?.map((i) => i.value),
		["force"],
	);
	assert.equal(completeMode("")?.length, 3);
	assert.equal(completeMode("zzz"), null);
});
