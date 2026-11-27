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
	transitStatus,
	activeTodos,
	todoBoard,
	nextEnergy,
	nextUrgency,
} from "../src/lib/todo-core";

const page = (over: Partial<Parameters<typeof pendingTodos>[0][number]> = {}) => ({
	name: "p",
	ctime: 1000,
	status: "",
	related: undefined,
	completed: 0,
	energy: "",
	urgency: "",
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

// transitStatus：状态机合法流转生效，非法流转返回 null（ADR 0008）
void test("transitStatus legal transitions", () => {
	assert.equal(transitStatus("pending", "doing"), "doing");
	assert.equal(transitStatus("pending", "done"), "done");
	assert.equal(transitStatus("pending", "dropped"), "dropped");
	assert.equal(transitStatus("doing", "pending"), "pending");
	assert.equal(transitStatus("doing", "done"), "done");
	assert.equal(transitStatus("doing", "dropped"), "dropped");
	assert.equal(transitStatus("dropped", "pending"), "pending");
});
void test("transitStatus illegal transitions return null", () => {
	assert.equal(transitStatus("done", "pending"), null);
	assert.equal(transitStatus("done", "doing"), null);
	assert.equal(transitStatus("dropped", "done"), null);
	assert.equal(transitStatus("dropped", "doing"), null);
	assert.equal(transitStatus("", "doing"), null);
	assert.equal(transitStatus("pending", "unknown"), null);
});

// activeTodos：pending+doing 都算活跃，ctime 倒序
void test("activeTodos includes doing, sorts newest first", () => {
	const out = activeTodos([
		page({ name: "d", ctime: 1, status: "doing" }),
		page({ name: "n", ctime: 3, status: "pending" }),
		page({ name: "done", ctime: 4, status: "done" }),
		page({ name: "o", ctime: 2, status: "pending" }),
	]);
	assert.deepEqual(out.map((p) => p.name), ["n", "o", "d"]);
});

// todoBoard：分组/排序/统计条口径
void test("todoBoard groups pending by urgency, sorts by ctime desc", () => {
	const b = todoBoard(
		[
			page({ name: "s1", status: "pending", urgency: "soon", ctime: 1 }),
			page({ name: "s2", status: "pending", urgency: "soon", ctime: 2 }),
			page({ name: "n1", status: "pending", urgency: "now", ctime: 3 }),
			page({ name: "y1", status: "pending", urgency: "someday", ctime: 4 }),
			page({ name: "un", status: "pending", urgency: "", ctime: 5 }),
		],
		NOW,
	);
	assert.deepEqual(b.now.map((p) => p.name), ["n1"]);
	assert.deepEqual(b.soon.map((p) => p.name), ["s2", "s1"]);
	assert.deepEqual(b.someday.map((p) => p.name), ["y1"]);
	assert.deepEqual(b.doing, []);
});
void test("todoBoard doing section and done sorted by completed desc", () => {
	const b = todoBoard(
		[
			page({ name: "d2", status: "doing", ctime: 2 }),
			page({ name: "d1", status: "doing", ctime: 1 }),
			page({ name: "ok-old", status: "done", completed: NOW - 3 * DAY, ctime: 1 }),
			page({ name: "ok-new", status: "done", completed: NOW - DAY, ctime: 2 }),
		],
		NOW,
	);
	assert.deepEqual(b.doing.map((p) => p.name), ["d2", "d1"]);
	assert.deepEqual(b.done.map((p) => p.name), ["ok-new", "ok-old"]);
});
void test("todoBoard stats counts and deep percentage", () => {
	const b = todoBoard(
		[
			page({ name: "a", status: "doing", energy: "deep", ctime: 1 }),
			page({ name: "b", status: "pending", energy: "deep", urgency: "now", ctime: 2 }),
			page({ name: "c", status: "pending", energy: "shallow", urgency: "soon", ctime: 3 }),
			page({ name: "ok", status: "done", completed: NOW - DAY, ctime: 4 }),
			page({ name: "dr", status: "dropped", ctime: NOW - DAY }),
		],
		NOW,
	);
	assert.deepEqual(b.stats, { doing: 1, pending: 2, doneWeek: 1, droppedWeek: 1, deepPct: 67 });
});
void test("todoBoard stats zero on empty and no active", () => {
	assert.deepEqual(todoBoard([], NOW).stats, {
		doing: 0,
		pending: 0,
		doneWeek: 0,
		droppedWeek: 0,
		deepPct: 0,
	});
	assert.deepEqual(todoBoard([page({ status: "done" })], NOW).stats.deepPct, 0);
});

// 分面循环切换：deep→shallow→deep；now→soon→someday→now
void test("facet cycle helpers", () => {
	assert.equal(nextEnergy("deep"), "shallow");
	assert.equal(nextEnergy("shallow"), "deep");
	assert.equal(nextUrgency("now"), "soon");
	assert.equal(nextUrgency("soon"), "someday");
	assert.equal(nextUrgency("someday"), "now");
});
