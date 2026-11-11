/**
 * initializer — adds `/init` and automatic project discovery to pi.
 *
 * Two branches, chosen programmatically by looking for AGENTS.md in the
 * project root:
 *
 *   no AGENTS.md  → send the agent the initialization prompt as a user message,
 *                   which triggers a turn: it investigates the project and
 *                   writes the file.
 *   AGENTS.md     → read it and queue its contents as a `nextTurn` message.
 *                   Nothing is sent and no turn is triggered; the instructions
 *                   ride along with whatever the user types next.
 *
 * Every prompt lives in prompt.md and is re-read on each invocation, so editing
 * it takes effect immediately.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { completeMode, parseMode } from "./src/args.ts";
import { registerDiscovery } from "./src/discovery.ts";
import {
	findAgentsFile,
	projectName,
	targetAgentsPath,
	today,
	type AgentsFile,
} from "./src/agents-file.ts";
import {
	buildPrompt,
	loadPromptFile,
	resolvePromptPath,
	type LoadedPrompts,
	type PromptVars,
	type SectionName,
} from "./src/prompt.ts";

/** customType of the queued context message. */
const INJECT_TYPE = "initializer-context";

interface InjectDetails {
	relpath: string;
	lines: number;
}

function makeVars(cwd: string, existing: AgentsFile | null): PromptVars {
	const target = targetAgentsPath(cwd);
	return {
		CWD: cwd,
		PROJECT_NAME: projectName(cwd),
		AGENTS_PATH: existing?.path ?? target.path,
		AGENTS_RELPATH: existing?.relpath ?? target.relpath,
		AGENTS_CONTENT: existing?.content ?? "",
		DATE: today(),
	};
}

export default function (pi: ExtensionAPI) {
	registerDiscovery(pi);

	/**
	 * Collapsed, the queued context is a single line — the point of /init on an
	 * existing project is that the agent gets the file, not that the user
	 * re-reads it. Expanding shows the full text that was attached.
	 */
	pi.registerMessageRenderer<InjectDetails>(INJECT_TYPE, (message, { expanded }, theme) => {
		const details = message.details;
		const relpath = details?.relpath ?? "AGENTS.md";
		const lines = details?.lines ?? 0;

		const header =
			theme.fg("accent", "/init") +
			" " +
			theme.fg("dim", `queued ${relpath} (${lines} lines) for the next message`);

		const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
		box.addChild(new Text(header, 0, 0));
		if (expanded && typeof message.content === "string") {
			box.addChild(new Text(theme.fg("dim", message.content), 0, 1));
		}
		return box;
	});

	pi.registerCommand("init", {
		description: "Write an AGENTS.md for this project, or load the existing one",
		getArgumentCompletions: completeMode,
		handler: async (args, ctx) => {
			const mode = parseMode(args);
			if (mode === null) {
				ctx.ui.notify(
					`/init: unknown argument "${args.trim()}" — expected one of: force, inject, status`,
					"warning",
				);
				return;
			}

			const existing = findAgentsFile(ctx.cwd);

			if (mode === "status") {
				reportStatus(ctx, existing);
				return;
			}

			if (mode === "inject" && !existing) {
				ctx.ui.notify(
					"/init: no AGENTS.md in this project yet — run /init to write one.",
					"warning",
				);
				return;
			}

			let prompts: LoadedPrompts;
			try {
				prompts = loadPromptFile(ctx.cwd);
			} catch (error) {
				ctx.ui.notify(`/init: ${(error as Error).message}`, "error");
				return;
			}

			// The programmatic branch: an existing AGENTS.md is loaded, not rewritten,
			// unless the user explicitly asked to regenerate it.
			if (existing && mode !== "force") {
				injectExisting(pi, ctx, prompts, existing);
				return;
			}

			generate(pi, ctx, prompts, existing);
		},
	});
}

/** Queue the existing AGENTS.md for the user's next message. Never triggers a turn. */
function injectExisting(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	prompts: LoadedPrompts,
	existing: AgentsFile,
): void {
	let content: string;
	try {
		content = buildPrompt(prompts, "inject", makeVars(ctx.cwd, existing));
	} catch (error) {
		ctx.ui.notify(`/init: ${(error as Error).message}`, "error");
		return;
	}

	pi.sendMessage<InjectDetails>(
		{
			customType: INJECT_TYPE,
			content,
			display: true,
			details: {
				relpath: existing.relpath,
				lines: existing.content.split("\n").length,
			},
		},
		// "nextTurn" is the whole point: queued for the next user prompt, it
		// interrupts nothing and triggers nothing.
		{ deliverAs: "nextTurn" },
	);

	ctx.ui.notify(
		`${existing.relpath} loaded — it goes to the agent with your next message. ` +
			`Use /init force to rewrite it instead.`,
		"info",
	);
}

/** Send the generation (or revision) prompt as a user message, triggering a turn. */
function generate(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	prompts: LoadedPrompts,
	existing: AgentsFile | null,
): void {
	const section: SectionName = existing ? "update" : "init";

	let prompt: string;
	try {
		prompt = buildPrompt(prompts, section, makeVars(ctx.cwd, existing));
	} catch (error) {
		ctx.ui.notify(`/init: ${(error as Error).message}`, "error");
		return;
	}

	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt);
		return;
	}

	// Mid-stream: queue behind the current work rather than cutting into it —
	// analysing a whole project is not a steering correction.
	pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	ctx.ui.notify(
		`/init queued — the agent will ${existing ? "revise" : "write"} ${
			existing?.relpath ?? "AGENTS.md"
		} once it finishes.`,
		"info",
	);
}

function reportStatus(ctx: ExtensionCommandContext, existing: AgentsFile | null): void {
	const promptPath = resolvePromptPath(ctx.cwd);
	const found = existing
		? `${existing.relpath} found (${existing.content.split("\n").length} lines) → /init loads it into context`
		: `no AGENTS.md in ${ctx.cwd} → /init asks the agent to write one`;

	ctx.ui.notify(`${found}\nprompts: ${promptPath}`, "info");
}
