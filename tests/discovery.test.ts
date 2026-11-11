import assert from "node:assert/strict";
import { exec } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { generateOverview, registerDiscovery, truncateToBudget } from "../src/discovery.ts";

const config = { budget: 1200, pass1: true, ignore: [] as string[] };
const execAsync = promisify(exec);

test("discovery ignores matching paths in Git and plain directories", async () => {
	for (const git of [false, true]) {
		const cwd = mkdtempSync(join(tmpdir(), "initializer-ignore-"));
		try {
			if (git) await execAsync("git init -q", { cwd });
			mkdirSync(join(cwd, "generated"));
			writeFileSync(join(cwd, "generated", "many.py"), "pass\n");
			writeFileSync(join(cwd, "app.ts"), "export {};\n");
			if (git) await execAsync("git add app.ts generated/many.py", { cwd });
			const result = await generateOverview(cwd, { ...config, ignore: ["generated"] });
			assert.match(result.text, /\bts\b/);
			assert.doesNotMatch(result.text, /\bpy\b/);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}
});

test("a malformed package.json does not suppress other project metadata", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "initializer-invalid-pkg-"));
	try {
		writeFileSync(join(cwd, "package.json"), "{invalid");
		writeFileSync(join(cwd, "app.ts"), "export {};\n");
		const result = await generateOverview(cwd, config);
		assert.match(result.text, /\bts\b/);
		assert.match(result.text, /proj: initializer-invalid-pkg-/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("budget keeps later overview fields when one line is very long", () => {
	const result = truncateToBudget(
		`proj: example | ts | monorepo:n | branch:main\nbuild: test=${"x".repeat(2000)}\nci: npm test\nagents: AGENTS.md (read on demand)`,
		100,
	);
	assert.ok(result.tokens <= 100);
	assert.match(result.text, /proj: example/);
	assert.match(result.text, /ci: npm test/);
	assert.match(result.text, /agents: AGENTS.md/);
});

test("disabled discovery produces no placeholder overview", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "initializer-disabled-"));
	try {
		assert.deepEqual(await generateOverview(cwd, { ...config, pass1: false }), { text: "", tokens: 0 });
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("discovery briefs a fresh session once and clears state for a resumed session", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "initializer-discovery-"));
	try {
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "briefed-project" }));
		const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
		const commands = new Map<string, unknown>();
		const statuses = new Map<string, string | undefined>();
		let entries: unknown[] = [];
		const pi = {
			on: (name: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
				handlers.set(name, handler);
			},
			registerCommand: (name: string, command: unknown) => commands.set(name, command),
		} as unknown as ExtensionAPI;
		const ctx = {
			cwd,
			sessionManager: { getEntries: () => entries },
			ui: {
				theme: { bg: (_color: string, text: string) => text, fg: (_color: string, text: string) => text },
				setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
			},
		};
		registerDiscovery(pi);
		assert.ok(commands.has("discovery"));

		await handlers.get("session_start")!({}, ctx);
		assert.match(statuses.get("discovery") ?? "", /discovery: \d+t/);
		const first = await handlers.get("before_agent_start")!({}, ctx);
		assert.match(JSON.stringify(first), /briefed-project/);
		assert.equal(await handlers.get("before_agent_start")!({}, ctx), undefined);

		entries = [{ type: "message", message: { role: "user" } }];
		await handlers.get("session_start")!({}, ctx);
		assert.equal(statuses.get("discovery"), undefined);
		assert.equal(await handlers.get("before_agent_start")!({}, ctx), undefined);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
