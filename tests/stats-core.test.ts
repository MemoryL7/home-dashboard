// stats-core 纯函数测试 —— 自 Scripts/stats-core.test.js 原样迁移（票 04）。
// 断言与原 Node 脚本逐条对应；仅外壳从手写 eq()/exit 换成 node:test。
import { test } from "node:test";
import assert from "node:assert/strict";
import { statsCore } from "../src/lib/stats-core";

const SC = statsCore();

// streak：跨月连续（1/31 → 2/1 相邻）
test("streak today", () => {
	assert.deepEqual(SC.streak(["2026-02-01", "2026-01-31", "2026-01-30"], "2026-02-01"), 3);
});
test("streak today-missing starts yesterday", () => {
	assert.deepEqual(SC.streak(["2026-02-01", "2026-01-31"], "2026-02-02"), 2);
});
test("streak broken by gap", () => {
	assert.deepEqual(SC.streak(["2026-02-01", "2026-01-29"], "2026-02-01"), 1);
});
test("streak empty", () => {
	assert.deepEqual(SC.streak([], "2026-02-01"), 0);
});

// bestStreak：乱序 + 重复去重 + 跨月
test("bestStreak", () => {
	assert.deepEqual(
		SC.bestStreak(["2026-01-31", "2026-02-01", "2026-02-02", "2026-02-02", "2026-03-01"]),
		3,
	);
});
test("bestStreak empty", () => {
	assert.deepEqual(SC.bestStreak([]), 0);
});

// countBy：空键跳过
test("countBy", () => {
	assert.deepEqual(
		SC.countBy([{ c: "待办" }, { c: "待办" }, { c: "" }, {}], (p) => p.c),
		{ 待办: 2 },
	);
});

// tagFreq：摊平计数
test("tagFreq", () => {
	assert.deepEqual(SC.tagFreq([{ tags: ["a", "b"] }, { tags: ["a"] }, { tags: undefined }]), {
		a: 2,
		b: 1,
	});
});

// —— 2026-11 自 stats-view 收编进 core 的口径 ——

// dayCounts：按 'YYYY-MM-DD' 键聚合计数
test("dayCounts", () => {
	const pages = [{ ctime: 0 }, { ctime: 0 }, { ctime: 86_400_000 }];
	const counts = SC.dayCounts(pages, (p) => p.ctime, (ms) => new Date(ms).toISOString().slice(0, 10));
	assert.deepEqual(counts, { "1970-01-01": 2, "1970-01-02": 1 });
	assert.deepEqual(SC.dayCounts([], (p) => p.ctime, () => "x"), {});
});

// heatmapLevel：边界 → lv0–lv4（≤1→1，≤3→2，≤5→3）
test("heatmapLevel boundaries", () => {
	assert.deepEqual([0, 1, 2, 3, 5, 6, 99].map(SC.heatmapLevel), [0, 1, 2, 2, 3, 4, 4]);
});

// weekStart：周三回退到同一时刻的周一（本地时区）
test("weekStart rolls back to Monday, keeps time of day", () => {
	// 2026-11-18 是周三；14:30 本地时刻
	const wed = new Date(2026, 10, 18, 14, 30, 0, 0).getTime();
	const mon = new Date(2026, 10, 16, 14, 30, 0, 0).getTime();
	assert.deepEqual(SC.weekStart(wed), mon);
	// 周一自身不动；周日（getDay=0）回退 6 天
	assert.deepEqual(SC.weekStart(mon), mon);
	const sun = new Date(2026, 10, 22, 8, 0, 0, 0).getTime();
	assert.deepEqual(SC.weekStart(sun), new Date(2026, 10, 16, 8, 0, 0, 0).getTime());
});

// insightText：空窗提示 / 大类占比 + 连续天数文案
test("insightText empty recent window", () => {
	const pages = [{ ctime: 0, category: "待办" }];
	assert.match(SC.insightText(pages, 3, Date.now()), /近 7 天还没有随手记/);
});
test("insightText top category with share and streak", () => {
	const now = Date.now();
	const pages = [
		{ ctime: now - 1000, category: "待办" },
		{ ctime: now - 2000, category: "待办" },
		{ ctime: now - 3000, category: "生活" },
	];
	assert.deepEqual(
		SC.insightText(pages, 5, now),
		"近 7 天共记 3 条，「待办」占比 67%；已连续记录 5 天，保持节奏 🎋",
	);
});
