// todo-core 纯函数测试：待办策略口径（pending 判定/周窗完成/跟进解析与计数）。
// 原逻辑锁在 todo-view 的 render 里无法直测，2026-11 收敛进 core 后补齐。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
	relatedTargets,
	pendingTodos,
	doneInWeek,
	followupCounts,
	followupsFor,
	stripFrontmatter,
} from "../src/lib/todo-core";

const page = (over: Partial<Parameters<typeof pendingTodos>[0][number]> = {}) => ({
	name: "p",
	ctime: 1000,
	status: "",
	related: undefined,
	completed: 0,
	...over,
});

// relatedTargets：wikilink 字符串（含别名/子路径）、{path} 对象、数组、噪声
void test("relatedTargets wikilink forms", () => {
	assert.deepEqual(relatedTargets('"[[待办-办事申请]]"'), ["待办-办事申请"]);
	assert.deepEqual(relatedTargets("[[某名|别名]]"), ["某名"]);
	assert.deepEqual(relatedTargets("[[Inbox/某名#节]]"), ["Inbox/某名"]);
});
void test("relatedTargets TFile-like path objects", () => {
	assert.deepEqual(relatedTargets([{ path: "Inbox/某名.md" }]), ["某名"]);
});
void test("relatedTargets arrays and noise", () => {
	assert.deepEqual(relatedTargets(["[[a]]", null, 42, ""]), ["a"]);
	assert.deepEqual(relatedTargets(undefined), []);
	assert.deepEqual(relatedTargets("纯文本无链接"), []);
});

// pendingTodos：只留 pending，ctime 倒序
void test("pendingTodos filters and sorts newest first", () => {
	const out = pendingTodos([
		page({ name: "old", ctime: 1, status: "pending" }),
		page({ name: "done", ctime: 2, status: "done" }),
		page({ name: "new", ctime: 3, status: "pending" }),
		page({ name: "draft", ctime: 4, status: "" }),
	]);
	assert.deepEqual(out.map((p) => p.name), ["new", "old"]);
});

// doneInWeek：completed 优先，旧数据回退 ctime，窗口外不算
const NOW = 1000 * 60 * 60 * 24 * 100; // 某固定「现在」
const DAY = 24 * 3600 * 1000;
void test("doneInWeek prefers completed, falls back to ctime", () => {
	const pages = [
		page({ status: "done", completed: NOW - 2 * DAY, ctime: NOW - 90 * DAY }),
		page({ status: "done", completed: 0, ctime: NOW - 3 * DAY }),
		page({ status: "done", completed: NOW - 8 * DAY, ctime: NOW - 90 * DAY }),
		page({ status: "pending", completed: NOW, ctime: NOW }),
	];
	assert.deepEqual(doneInWeek(pages, NOW), 2);
});

// followupCounts：一遍摊平，同名多跟进累计
void test("followupCounts tallies per target", () => {
	const pages = [
		page({ name: "f1", related: '"[[todo-a]]"' }),
		page({ name: "f2", related: ["[[todo-a]]", { path: "Inbox/todo-b.md" }] }),
		page({ name: "f3", related: '"[[别的事]]"' }),
	];
	assert.deepEqual(followupCounts(pages), { "todo-a": 2, "todo-b": 1, "别的事": 1 });
});
void test("followupCounts empty", () => {
	assert.deepEqual(followupCounts([]), {});
});

// followupsFor：related 指向目标的页面，ctime 正序（先记在上）
void test("followupsFor filters by target, sorts oldest first", () => {
	const pages = [
		page({ name: "f2", ctime: 200, summary: "乙", related: '"[[todo-a]]"' }),
		page({ name: "f1", ctime: 100, summary: "甲", related: '"[[todo-a]]"' }),
		page({ name: "f3", ctime: 300, summary: "丙", related: '"[[todo-b]]"' }),
		page({ name: "f4", ctime: 400, summary: "丁", related: undefined }),
	];
	const out = followupsFor(pages, "todo-a");
	assert.deepEqual(out.map((f) => f.name), ["f1", "f2"]);
});

// stripFrontmatter：有 fm 去头，无 fm 原样
void test("stripFrontmatter removes leading yaml block", () => {
	assert.equal(stripFrontmatter("---\nstatus: pending\n---\n正文\n"), "正文\n");
	assert.equal(stripFrontmatter("直接正文"), "直接正文");
});
