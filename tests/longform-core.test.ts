// longform-core 纯函数测试（票 07）：草稿文件名/初始 frontmatter/草稿清单。
// 编辑器是会话级 Modal（ADR 0002 会话级语义不变），文件实时落盘；
// 草稿 status: draft 不进统计（inbox-query 已排除），只在草稿箱出现。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	draftFilePath,
	draftFrontmatter,
	collectDrafts,
	splitFrontmatter,
	applyMdAction,
	type DraftSnapshot,
} from "../src/lib/longform-core";

const draft = (
	path: string,
	mtime: number,
	fm: Record<string, unknown> = {},
): DraftSnapshot => ({
	path,
	basename: path.replace(/.*\//, "").replace(/\.md$/, ""),
	mtime,
	cache: { frontmatter: fm },
});

void test("draftFilePath sanitizes title into a safe filename", () => {
	const path = draftFilePath("Inbox", '随手记:一些#想法[草稿]/2026', 0, []);
	assert.equal(path, "Inbox/随手记一些想法草稿2026.md");
});

void test("draftFilePath falls back to 未命名 when the title is all punctuation", () => {
	const path = draftFilePath("Inbox", "   ///  ", 0, []);
	assert.equal(path, "Inbox/未命名.md");
});

void test("draftFilePath appends a timestamp on collision", () => {
	const path = draftFilePath("Inbox", "竹林笔记", 1731900000000, ["Inbox/竹林笔记.md"]);
	// stamp: local-time YYYY-MM-DD-HHmmss of the injected ms
	assert.match(path, /^Inbox\/竹林笔记-\d{4}-\d{2}-\d{2}-\d{6}\.md$/);
});

void test("draftFrontmatter marks status draft with empty classification slots", () => {
	const fm = draftFrontmatter();
	assert.match(fm, /^---\n/);
	assert.match(fm, /\nstatus: draft\n/);
	assert.match(fm, /\ncategory: ''/);
	assert.doesNotMatch(fm, /status: ''/);
});

void test("collectDrafts keeps only Inbox markdown with status draft, newest first", () => {
	const pages = collectDrafts(
		[
			draft("Inbox/草稿A.md", 100, { status: "draft" }),
			draft("Inbox/已转正.md", 200, { status: "" }),
			draft("_Index/00-top.md", 300, { status: "draft" }),
			draft("Elsewhere/草稿B.md", 400, { status: "draft" }),
			draft("Inbox/日文件.md", 500, { type: "daylog", status: "draft" }),
			draft("Inbox/草稿C.md", 600, { status: "draft" }),
		],
		"Inbox",
	);
	assert.deepEqual(pages.map((p) => p.basename), ["草稿C", "草稿A"]);
});

void test("collectDrafts tolerates missing frontmatter", () => {
	const pages = collectDrafts([draft("Inbox/x.md", 1, {})], "Inbox");
	assert.deepEqual(pages, []);
});

void test("splitFrontmatter splits the leading fence and keeps it verbatim", () => {
	const fm = draftFrontmatter();
	const [head, body] = splitFrontmatter(`${fm}正文第一段\n\n第二段\n`);
	assert.equal(head, fm);
	assert.equal(body, "正文第一段\n\n第二段\n");
});

void test("splitFrontmatter treats fence-less content as all body", () => {
	const [head, body] = splitFrontmatter("没有 frontmatter 的笔记\n");
	assert.equal(head, "");
	assert.equal(body, "没有 frontmatter 的笔记\n");
});

void test("splitFrontmatter only matches a fence at the very start", () => {
	const [head, body] = splitFrontmatter("正文里有\n---\n围栏\n");
	assert.equal(head, "");
	assert.equal(body, "正文里有\n---\n围栏\n");
});

/* —— applyMdAction：工具栏 Markdown 格式化 —— */

void test("applyMdAction wraps the selection with the marker", () => {
	const r = applyMdAction("前面 Selected 后面", 3, 11, "bold");
	assert.equal(r.text, "前面 **Selected** 后面");
	assert.equal(r.text.slice(r.start, r.end), "Selected");
});

void test("applyMdAction inserts placeholder text on empty selection", () => {
	const r = applyMdAction("ab", 1, 1, "italic");
	assert.equal(r.text, "a*斜体文字*b");
	assert.equal(r.text.slice(r.start, r.end), "斜体文字");
});

void test("applyMdAction toggles an already-wrapped selection off", () => {
	const r = applyMdAction("x **强调** y", 2, 8, "bold");
	assert.equal(r.text, "x 强调 y");
	assert.equal(r.text.slice(r.start, r.end), "强调");
});

void test("applyMdAction prefixes each selected line and toggles off", () => {
	const r = applyMdAction("第一行\n第二行", 0, 6, "list");
	assert.equal(r.text, "- 第一行\n- 第二行");
	const off = applyMdAction(r.text, 0, r.text.length, "list");
	assert.equal(off.text, "第一行\n第二行");
});

void test("applyMdAction extends the prefix to the whole last line", () => {
	const r = applyMdAction("甲\n乙丙", 0, 2, "quote");
	assert.equal(r.text, "> 甲\n> 乙丙");
});

void test("applyMdAction link keeps the label and selects the URL", () => {
	const r = applyMdAction("看 这个", 2, 4, "link");
	assert.equal(r.text, "看 [这个](链接地址)");
	assert.equal(r.text.slice(r.start, r.end), "链接地址");
});
