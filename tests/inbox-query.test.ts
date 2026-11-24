// inbox-query 纯函数测试：vault.getMarkdownFiles() + metadataCache 文件缓存
// → 统计用的页面列表（票 04：统计不依赖 Dataview，自实现同一套查询口径）。
// 口径与 Home.md 的 loadInbox 一致：Inbox 目录、排除 daylog、排除草稿。
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectInbox, completedTs, type FileCacheLike } from "../src/lib/inbox-query";

const file = (
	path: string,
	ctime: number,
	fm: Record<string, unknown> = {},
): { path: string; basename: string; ctime: number; cache: FileCacheLike } => ({
	path,
	basename: path.replace(/.*\//, "").replace(/\.md$/, ""),
	ctime,
	cache: { frontmatter: fm },
});

void test("keeps only markdown notes inside the inbox dir", () => {
	const pages = collectInbox(
		[
			file("Inbox/a.md", 1),
			file("_Index/00-top.md", 2),
			file("Elsewhere/b.md", 3),
			file("Inbox/sub/c.md", 4),
		],
		"Inbox",
	);
	assert.deepEqual(
		pages.map((p) => p.path),
		["Inbox/a.md", "Inbox/sub/c.md"],
	);
});

void test("drops daylog files by frontmatter type", () => {
	const pages = collectInbox([file("Inbox/d.md", 1, { type: "daylog" }), file("Inbox/e.md", 2)], "Inbox");
	assert.deepEqual(
		pages.map((p) => p.path),
		["Inbox/e.md"],
	);
});

void test("drops longform drafts so they stay out of stats/heatmap (ticket 07 约定)", () => {
	const pages = collectInbox([file("Inbox/dr.md", 1, { status: "draft" }), file("Inbox/ok.md", 2)], "Inbox");
	assert.deepEqual(
		pages.map((p) => p.path),
		["Inbox/ok.md"],
	);
});

void test("coerces frontmatter fields and defaults missing ones", () => {
	const pages = collectInbox(
		[file("Inbox/a.md", 123, { summary: "s", category: "待办", status: "pending", tags: ["t1", 2, "t2"], related: "x" })],
		"Inbox",
	);
	assert.deepEqual(pages[0], {
		path: "Inbox/a.md",
		name: "a",
		ctime: 123,
		summary: "s",
		category: "待办",
		status: "pending",
		tags: ["t1", "t2"],
		related: "x",
		completed: 0,
	});
	const bare = collectInbox([file("Inbox/b.md", 5)], "Inbox")[0];
	assert.deepEqual(bare.summary, "");
	assert.deepEqual(bare.category, "");
	assert.deepEqual(bare.status, "");
	assert.deepEqual(bare.tags, []);
	assert.deepEqual(bare.related, undefined);
});

void test("order follows input order (no hidden sorting)", () => {
	const pages = collectInbox([file("Inbox/z.md", 9), file("Inbox/a.md", 1)], "Inbox");
	assert.deepEqual(
		pages.map((p) => p.name),
		["z", "a"],
	);
});

void test("completedTs — localStamp 格式的 completed 解析为本地时刻，缺失/非法为 0", () => {
	// 东八区机器上 "2026-11-20 23:41:07" 应解析为本地 23:41:07 的 ms
	const ts = completedTs("2026-11-20 23:41:07");
	const d = new Date(ts);
	const p2 = (n: number): string => String(n).padStart(2, "0");
	assert.equal(
		[d.getFullYear(), d.getMonth() + 1, d.getDate()].map(p2).join("-"),
		"2026-11-20",
	);
	assert.equal([d.getHours(), d.getMinutes(), d.getSeconds()].map(p2).join(":"), "23:41:07");
	assert.equal(completedTs(undefined), 0);
	assert.equal(completedTs(""), 0);
	assert.equal(completedTs("not-a-date"), 0);
	// collectInbox 把 fm.completed 里的字符串解析进 InboxPage.completed
	const pages = collectInbox(
		[
			{
				path: "Inbox/done.md",
				basename: "done",
				ctime: 1,
				cache: { frontmatter: { status: "done", completed: "2026-11-20 23:41:07" } },
			},
		],
		"Inbox",
	);
	assert.equal(pages[0].completed, ts);
});
