/**
 * Automatic project discovery for initializer.
 *
 * At session start, injects ONE compact, token-efficient project overview
 * into the agent's initial context. Status bar shows token count until
 * the first message arrives.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative, extname } from "node:path";

const execAsync = promisify(exec);
const MAX_DEPTH = 5;
const MAX_FILES = 5000;

// ── Config ────────────────────────────────────────────────────────

export interface DiscoveryConfig {
	budget: number;
	pass1: boolean;
	ignore: string[];
}

export function readDiscoveryConfig(env: NodeJS.ProcessEnv = process.env): DiscoveryConfig {
	const requestedBudget = Number.parseInt(env.DISCOVERY_BUDGET || "1200", 10);
	return {
		budget: Number.isFinite(requestedBudget) && requestedBudget > 0 ? requestedBudget : 1200,
		pass1: env.DISCOVERY_PASS1 !== "false",
		ignore: (env.DISCOVERY_IGNORE || "").split(",").map((part) => part.trim()).filter(Boolean),
	};
}

// ── Types ─────────────────────────────────────────────────────────

interface ProjectMeta {
	name: string;
	langs: string[];
	monorepo: boolean;
	branch: string;
	build: Record<string, string>;
	ci: string[];
	infra: string[];
	agentFiles: string[];
	workspaceGlobs: string[];
}

// ── Helpers ───────────────────────────────────────────────────────

async function run(cmd: string, cwd: string): Promise<string> {
	try {
		const { stdout } = await execAsync(cmd, {
			cwd,
			encoding: "utf-8",
			timeout: 15_000,
		});
		return stdout.trim();
	} catch {
		return "";
	}
}

async function read(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf-8");
	} catch {
		return null;
	}
}

async function isGitRepo(cwd: string): Promise<boolean> {
	return !!(await run("git rev-parse --git-dir", cwd));
}

function tokenCount(text: string): number {
	return estimateTokens({
		role: "user" as const,
		content: [{ type: "text" as const, text }],
		timestamp: Date.now(),
	});
}

// ── File Inventory ────────────────────────────────────────────────

function isIgnored(path: string, ignore: string[]): boolean {
	return ignore.some((entry) => path === entry || path.startsWith(`${entry}/`) || path.split("/").includes(entry));
}

async function listFiles(cwd: string, git: boolean, ignore: string[]): Promise<string[]> {
	if (git) {
		const [tracked, untracked] = await Promise.all([
			run("git ls-files", cwd),
			run("git ls-files --others --exclude-standard", cwd),
		]);
		return `${tracked}\n${untracked}`
			.split("\n")
			.map((f: string) => f.trim())
			.filter((f) => !!f && !isIgnored(f, ignore));
	}

	const SKIP = new Set([
		"node_modules",
		"dist",
		"build",
		".venv",
		"target",
		"vendor",
		".git",
			...ignore,
	]);

	const result: string[] = [];
	async function walk(dir: string, depth: number): Promise<void> {
		if (depth > MAX_DEPTH || result.length >= MAX_FILES) return;
		try {
			const entries = await readdir(dir, { withFileTypes: true });
			for (const e of entries) {
				const relpath = relative(cwd, join(dir, e.name));
				if (isIgnored(relpath, ignore) || (e.isDirectory() && SKIP.has(e.name))) continue;
				const full = join(dir, e.name);
				if (e.isDirectory()) {
					await walk(full, depth + 1);
				} else {
					result.push(relpath);
				}
			}
		} catch {
			/* skip unreadable dirs */
		}
	}
	await walk(cwd, 0);
	return result;
}

// ── Pass 1: Metadata ──────────────────────────────────────────────

function countLangs(files: string[]): Record<string, number> {
	const exts: Record<string, number> = {};
	const LANG_MAP: Record<string, string> = {
		".ts": "ts",
		".tsx": "tsx",
		".js": "js",
		".jsx": "jsx",
		".py": "py",
		".rs": "rs",
		".go": "go",
		".java": "java",
		".rb": "rb",
		".php": "php",
		".cs": "cs",
		".cpp": "cpp",
		".c": "c",
		".h": "h",
		".hpp": "hpp",
		".swift": "swift",
		".kt": "kt",
		".scala": "scala",
		".r": "r",
		".R": "r",
		".sh": "sh",
		".bash": "sh",
		".zsh": "sh",
		".toml": "toml",
		".yaml": "yaml",
		".yml": "yaml",
		".json": "json",
		".md": "md",
		".html": "html",
		".css": "css",
		".sql": "sql",
		".graphql": "graphql",
		".proto": "proto",
	};
	for (const f of files) {
		const ext = extname(f).toLowerCase();
		const lang = LANG_MAP[ext] || ext;
		// Skip non-source extensions for language counting
		if ([".md", ".json", ".yaml", ".yml", ".toml", ".lock", ""].includes(ext))
			continue;
		exts[lang] = (exts[lang] || 0) + 1;
	}
	return exts;
}

async function extractMeta(
	cwd: string,
	files: string[],
	git: boolean,
): Promise<ProjectMeta> {
	const meta: ProjectMeta = {
		name: "",
		langs: [],
		monorepo: false,
		branch: "",
		build: {},
		ci: [],
		infra: [],
		agentFiles: [],
		workspaceGlobs: [],
	};

	const fileSet = new Set(files);

	// Git branch
	if (git) {
		meta.branch = (await run("git branch --show-current", cwd)) || "(detached)";
	}

	// Languages
	const langCounts = countLangs(files);
	const sorted = Object.entries(langCounts).sort((a, b) => b[1] - a[1]);
	meta.langs = sorted.slice(0, 3).map(([l]) => l);

	// package.json
	if (fileSet.has("package.json")) {
		const pkgRaw = await read(join(cwd, "package.json"));
		let pkg: Record<string, unknown> = {};
		if (pkgRaw) {
			try {
				const parsed: unknown = JSON.parse(pkgRaw);
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					pkg = parsed as Record<string, unknown>;
				}
			} catch {
				// An invalid manifest should not suppress the rest of the overview.
			}
		}
		if (typeof pkg.name === "string") meta.name = pkg.name;
		if (pkg.scripts && typeof pkg.scripts === "object" && !Array.isArray(pkg.scripts)) {
			for (const [k, v] of Object.entries(pkg.scripts)) {
				if (typeof v === "string") meta.build[k] = v;
			}
		}
		if (pkg.workspaces) {
			meta.monorepo = true;
			meta.workspaceGlobs = Array.isArray(pkg.workspaces)
				? pkg.workspaces.filter((item): item is string => typeof item === "string")
				: typeof pkg.workspaces === "object" && "packages" in pkg.workspaces && Array.isArray(pkg.workspaces.packages)
					? pkg.workspaces.packages.filter((item): item is string => typeof item === "string")
					: [];
		}
	}

	// pnpm-workspace.yaml / turbo.json / nx.json / lerna.json
	for (const marker of [
		"pnpm-workspace.yaml",
		"turbo.json",
		"nx.json",
		"lerna.json",
	]) {
		if (fileSet.has(marker)) {
			meta.monorepo = true;
		}
	}

	// pyproject.toml
	if (fileSet.has("pyproject.toml")) {
		const content = await read(join(cwd, "pyproject.toml"));
		if (content) {
			const nameM = content.match(/name\s*=\s*"([^"]+)"/);
			if (nameM?.[1] && !meta.name) meta.name = nameM[1];
			// Extract [tool.setuptools.scripts] or [project.scripts]
			const scripts = content.match(/\[project\.scripts\][\s\S]*?(?=\[|$)/);
			if (scripts) {
				for (const m of scripts[0].matchAll(/(\w+)\s*=\s*"([^"]+)"/g)) {
					if (m[1] && m[2]) meta.build[m[1]] = m[2];
				}
			}
		}
	}

	// Cargo.toml
	if (fileSet.has("Cargo.toml")) {
		const content = await read(join(cwd, "Cargo.toml"));
		if (content) {
			const nameM = content.match(/name\s*=\s*"([^"]+)"/);
			if (nameM?.[1] && !meta.name) meta.name = nameM[1];
		}
	}

	// go.mod
	if (fileSet.has("go.mod")) {
		const content = await read(join(cwd, "go.mod"));
		if (content) {
			const modM = content.match(/module\s+(.+)$/m);
			if (modM?.[1] && !meta.name) meta.name = modM[1].trim();
		}
	}

	// Makefile targets
	if (fileSet.has("Makefile")) {
		const content = await read(join(cwd, "Makefile"));
		if (content) {
			for (const m of content.matchAll(/^([a-zA-Z][\w-]*)\s*:/gm)) {
				const target = m[1];
				if (!target) continue;
				if (!["all", "clean", "install"].includes(target)) {
					// Get the first recipe line (a tab-indented line after the target)
					const escapedTarget = target.replace(
						/[.*+?^${}()|[\]\\]/g,
						"\\$&",
					);
					const targetBlock = content.match(
						new RegExp(`^${escapedTarget}:[^\\n]*\\n\\s+(.+)$`, "m"),
					);
					if (targetBlock) {
						meta.build[target] = targetBlock[1]?.trim() ?? "";
					} else {
						meta.build[target] = "";
					}
				}
			}
		}
	}

	// justfile
	if (fileSet.has("justfile")) {
		const content = await read(join(cwd, "justfile"));
		if (content) {
			for (const m of content.matchAll(/^([a-zA-Z][\w-]*)\b/gm)) {
				const recipe = m[1];
				if (!recipe) continue;
				if (!meta.build[recipe]) {
					meta.build[recipe] = "";
				}
			}
		}
	}

	// CI: .github/workflows/*.yml
	for (const f of files) {
		if (
			f.startsWith(".github/workflows/") &&
			(f.endsWith(".yml") || f.endsWith(".yaml"))
		) {
			const content = await read(join(cwd, f));
			if (content) {
				// Extract run: commands
				for (const m of content.matchAll(/run:\s*(.+)$/gm)) {
					const cmd = m[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
					if (cmd && !meta.ci.includes(cmd)) meta.ci.push(cmd);
				}
			}
		}
		if (f === ".gitlab-ci.yml") {
			const content = await read(join(cwd, f));
			if (content) {
				for (const m of content.matchAll(
					/- (?:sh -c )?["']?([^"'\n]+)["']?/gm,
				)) {
					const cmd = m[1]?.trim() ?? "";
					if (cmd && cmd.length < 200 && !meta.ci.includes(cmd))
						meta.ci.push(cmd);
				}
			}
		}
	}

	// Infrastructure detection (presence-only)
	const INFRA_MARKERS = [
		"Dockerfile",
		"docker-compose.yml",
		"docker-compose.yaml",
		"k8s",
		"helm",
		"Chart.yaml",
		"tsconfig.json",
		".eslintrc",
		".eslintrc.json",
		".eslintrc.js",
		".prettierrc",
		"prettier.config.js",
		"ruff.toml",
		".ruff.toml",
		".nvmrc",
		".tool-versions",
		".node-version",
	];
	for (const marker of INFRA_MARKERS) {
		if (fileSet.has(marker)) {
			meta.infra.push(marker);
		} else {
			// Check for directory markers
			for (const f of files) {
				if (f.startsWith(marker + "/") && !meta.infra.includes(marker)) {
					meta.infra.push(marker);
					break;
				}
			}
		}
	}

	// Agent instruction files
	const AGENT_FILES = ["AGENTS.md", "CLAUDE.md", ".cursorrules", "PI.md"];
	for (const af of AGENT_FILES) {
		if (fileSet.has(af)) meta.agentFiles.push(af);
	}

	// Fallback project name
	if (!meta.name) {
		meta.name = basename(cwd);
	}

	return meta;
}

// ── Format Overview ───────────────────────────────────────────────

function formatOverview(meta: ProjectMeta): string {
	const lines: string[] = [];

	// Header
	const langStr = meta.langs.join("+") || "?";
	const monoStr = meta.monorepo ? "y" : "n";
	lines.push(
		`proj: ${meta.name} | ${langStr} | monorepo:${monoStr} | branch:${meta.branch}`,
	);

	// Build commands
	if (Object.keys(meta.build).length > 0) {
		const buildEntries = Object.entries(meta.build);
		const buildStr = buildEntries
			.slice(0, 8)
			.map(([k, v]) => `${k}=${v}`)
			.join(" ");
		const buildLine =
			buildEntries.length > 8
				? `${buildStr} +${buildEntries.length - 8} more`
				: buildStr;
		lines.push(`build: ${buildLine}`);
	}

	// CI
	if (meta.ci.length > 0) {
		const ciStr = meta.ci.slice(0, 3).join(" | ");
		lines.push(`ci: ${ciStr}`);
	}

	// Infra
	if (meta.infra.length > 0) {
		lines.push(`infra: ${meta.infra.join(" ")}`);
	}

	// Agent files
	if (meta.agentFiles.length > 0) {
		lines.push(`agents: ${meta.agentFiles.join(" ")} (read on demand)`);
	}

	// Workspace globs
	if (meta.workspaceGlobs.length > 0) {
		lines.push(`workspaces: ${meta.workspaceGlobs.join(" ")}`);
	}

	return lines.join("\n");
}

// ── Truncate to Budget ────────────────────────────────────────────

export function truncateToBudget(
	text: string,
	budget: number,
): { text: string; tokens: number } {
	if (!text || budget <= 0) return { text: "", tokens: 0 };
	if (tokenCount(text) <= budget) return { text, tokens: tokenCount(text) };

	const lines = text.split("\n");
	const perLine = Math.max(1, Math.floor(budget / lines.length));
	const kept: string[] = [];
	for (const line of lines) {
		let lo = 0;
		let hi = line.length;
		let best = "";
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const candidate = mid === line.length ? line : `${line.slice(0, mid).trimEnd()}…`;
			const combined = [...kept, candidate].join("\n");
			if (tokenCount(candidate) <= perLine && tokenCount(combined) <= budget) {
				best = candidate;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		if (best) kept.push(best);
	}
	const result = kept.join("\n");
	return { text: result, tokens: result ? tokenCount(result) : 0 };
}

// ── Generate Overview ─────────────────────────────────────────────

export async function generateOverview(
	cwd: string,
	config: DiscoveryConfig = readDiscoveryConfig(),
): Promise<{ text: string; tokens: number }> {
	if (!config.pass1) return { text: "", tokens: 0 };
	const git = await isGitRepo(cwd);
	const files = await listFiles(cwd, git, config.ignore);

	let meta: ProjectMeta = {
		name: "",
		langs: [],
		monorepo: false,
		branch: "",
		build: {},
		ci: [],
		infra: [],
		agentFiles: [],
		workspaceGlobs: [],
	};

	meta = await extractMeta(cwd, files, git);
	return truncateToBudget(formatOverview(meta), config.budget);
}

// ── Extension ─────────────────────────────────────────────────────

export function registerDiscovery(pi: ExtensionAPI) {
	const config = readDiscoveryConfig();
	let overviewText = "";
	let overviewTokens = 0;
	let injected = false;
	let sessionHasMessages = false;

	pi.on("session_start", async (_event, ctx) => {
		overviewText = "";
		overviewTokens = 0;
		injected = false;
		sessionHasMessages = false;

		// Check if session already has user messages (resume/fork / --continue)
		const entries = ctx.sessionManager.getEntries();
		const hasUserMessages = entries.some(
			(e) => e.type === "message" && e.message?.role === "user",
		);
		if (hasUserMessages) {
			sessionHasMessages = true;
			updateStatusBar(ctx);
			return; // Skip discovery for resumed sessions (e.g. pi --continue)
		}

		// Generate overview
		try {
			const result = await generateOverview(ctx.cwd, config);
			overviewText = result.text;
			overviewTokens = result.tokens;
		} catch (err) {
			console.error("[discovery] Failed to generate overview:", err);
			overviewText = "";
			overviewTokens = 0;
			return;
		}

		// Update status bar
		updateStatusBar(ctx);
	});

	pi.on("before_agent_start", async (_event, _ctx) => {
		if (!overviewText || injected) return;

		injected = true;

		return {
			message: {
				customType: "discovery",
				content: overviewText,
				display: false,
			},
		};
	});

	pi.on("message_end", async (_event, ctx) => {
		if (!sessionHasMessages) {
			sessionHasMessages = true;
			updateStatusBar(ctx);
		}
	});

	pi.on("turn_start", async (_event, ctx) => {
		updateStatusBar(ctx);
	});

	function updateStatusBar(ctx: Parameters<Parameters<typeof pi.on>[1]>[1]) {
		const theme = ctx.ui.theme;
		if (!sessionHasMessages && overviewTokens > 0) {
			ctx.ui.setStatus(
				"discovery",
				theme.bg("customMessageBg", theme.fg("dim", `discovery: ${overviewTokens}t`)),
			);
		} else {
			ctx.ui.setStatus("discovery", undefined);
		}
	}

	// ── /discovery command ──────────────────────────────────────────
	pi.registerCommand("discovery", {
		description: "Show or regenerate the project discovery overview",
		handler: async (args: string | undefined, ctx) => {
			if (args?.trim() === "regen") {
				try {
					const result = await generateOverview(ctx.cwd, config);
					overviewText = result.text;
					overviewTokens = result.tokens;
					injected = false; // Force re-injection on next turn
					ctx.ui.notify(
						`Overview regenerated: ${overviewTokens} tokens`,
						"info",
					);
				} catch (err) {
					ctx.ui.notify(`Failed to regenerate: ${err}`, "error");
					return;
				}
			}

			const lines = [
				`Discovery Overview (${overviewTokens} tokens, budget: ${config.budget})`,
				`Pass1: ${config.pass1 ? "on" : "off"}`,
				`Injected: ${injected ? "yes" : "no"}`,
				"",
				overviewText || "(no overview generated)",
			];
			ctx.ui.setWidget("discovery", lines);
		},
	});
}
