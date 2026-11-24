import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuickNote } from "../src/lib/capture";
import type { TFileLike } from "../src/lib/classify-core";

/** In-memory fake of the vault slice createQuickNote touches. */
function fakeVault(): { vault: any; files: Record<string, string> } {
	const files: Record<string, string> = {};
	const vault = {
		adapter: {
			exists: async (p: string) => p in files,
			mkdir: async (_d: string) => {},
		},
		create: async (path: string, body: string): Promise<TFileLike> => {
			files[path] = body;
			return { path, name: path.split("/").pop()! };
		},
	};
	return { vault, files };
}

// Fixed clock: 2026-11-18 10:11:12 local time.
const NOW = new Date(2026, 10, 18, 10, 11, 12);

void test("createQuickNote lands a frontmattered note in Inbox with a timestamped name", async () => {
	const { vault, files } = fakeVault();

	const file = await createQuickNote(vault, { inboxDir: "Inbox" }, "买一棵竹子", NOW);

	assert.equal(file.path, "Inbox/2026-11-18-101112.md");
	const md = files["Inbox/2026-11-18-101112.md"];
	assert.match(md, /^---\n/);
	assert.match(md, /category: ''/m);
	assert.match(md, /---\n买一棵竹子\n$/);
});

void test("summary is collapsed whitespace truncated to 30 chars; body keeps raw text", async () => {
	const { vault, files } = fakeVault();
	const text = "  买一棵竹子\n顺便   浇水  ";

	await createQuickNote(vault, { inboxDir: "Inbox" }, text, NOW);

	const md = files["Inbox/2026-11-18-101112.md"];
	assert.match(md, /summary: "买一棵竹子 顺便 浇水"/);
	const long = "一".repeat(60);
	await createQuickNote(vault, { inboxDir: "Inbox" }, long, NOW);
	assert.match(
		files["Inbox/2026-11-18-101112.md"],
		new RegExp(`summary: "一{30}"`),
	);
	assert.match(
		files["Inbox/2026-11-18-101112.md"],
		/---\n一{60}\n$/,
		"body keeps the full raw text",
	);
});

void test("summary is YAML-quoted so ':' or quotes in the text cannot break the frontmatter", async () => {
	const { vault, files } = fakeVault();

	await createQuickNote(
		vault,
		{ inboxDir: "Inbox" },
		"读：三体\n说\"好\"的",
		NOW,
	);

	const md = files["Inbox/2026-11-18-101112.md"];
	assert.match(md, /^summary: "读：三体 说\\"好\\"的"$/m);
});

void test("respects a custom inboxDir convention", async () => {
	const { vault, files } = fakeVault();

	const file = await createQuickNote(vault, { inboxDir: "收集箱" }, "hi", NOW);

	assert.equal(file.path, "收集箱/2026-11-18-101112.md");
	assert.ok("收集箱/2026-11-18-101112.md" in files);
});
