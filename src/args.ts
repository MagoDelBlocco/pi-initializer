/**
 * `/init` argument parsing.
 *
 * Kept free of runtime dependencies (no pi-tui / pi-coding-agent imports) so it
 * can be unit tested outside pi's module loader — the same discipline the other
 * extensions follow for their pure logic.
 */

/** What the user asked /init to do. */
export type Mode = "auto" | "force" | "inject" | "status";

/** Completions offered after `/init `, in the order they are shown. */
export const MODE_COMPLETIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "force", label: "force — (re)generate AGENTS.md even if one exists" },
	{ value: "inject", label: "inject — queue the existing AGENTS.md for the next message" },
	{ value: "status", label: "status — show what /init would do here" },
];

/** Aliases, so the obvious word works whichever one the user reaches for. */
const MODE_ALIASES: Readonly<Record<string, Mode>> = {
	"": "auto",
	force: "force",
	update: "force",
	refresh: "force",
	regenerate: "force",
	inject: "inject",
	reload: "inject",
	context: "inject",
	status: "status",
	show: "status",
};

/** Returns null for anything unrecognised, so the handler can say so. */
export function parseMode(args: string): Mode | null {
	const key = args.trim().toLowerCase().replace(/^-+/, "");
	return Object.hasOwn(MODE_ALIASES, key) ? MODE_ALIASES[key]! : null;
}

/** Completions for `/init <prefix>`, or null when nothing matches. */
export function completeMode(prefix: string) {
	const needle = prefix.trim().toLowerCase();
	const items = MODE_COMPLETIONS.filter((m) => m.value.startsWith(needle));
	return items.length > 0 ? items : null;
}
