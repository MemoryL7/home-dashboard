import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWeekReview } from "../src/lib/weekly-review-core";

// Fixed "now": 2026-11-18 12:00 local — the worked example everything asserts
// against, independent of the implementation's clock handling.
const NOW = new Date(2026, 10, 18, 12, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const note = (over: Partial<Parameters<typeof buildWeekReview>[0][number]> = {}) => ({
	ctime: NOW - 1 * DAY,
	date: "11-17 09:00",
	category: "待办>工作",
	summary: "写周报",
	status: "pending",
	body: "把周报写完",
	...over,
});

void test("keeps only notes created within the trailing window, sorted oldest first", () => {
	const digest = buildWeekReview(
		[
			note({ ctime: NOW - 8 * DAY, date: "11-10 09:00" }), // outside: dropped
			note({ ctime: NOW - 2 * DAY, date: "11-16 10:00" }),
			note({ ctime: NOW - 1 * DAY, date: "11-17 09:00" }),
		],
		NOW,
	);
	assert.equal(digest?.notes.length, 2);
	assert.deepEqual(
		digest?.notes.map((n) => n.date),
		["11-16 10:00", "11-17 09:00"],
	);
});

void test("stats count records, distinct active days and pending todos", () => {
	const digest = buildWeekReview(
		[
			note({ ctime: NOW - 2 * DAY, date: "11-16 10:00", status: "" }),
			note({ ctime: NOW - 1 * DAY, date: "11-17 09:00" }),
			note({ ctime: NOW - 1 * DAY + 3600e3, date: "11-17 10:00", status: "pending" }),
		],
		NOW,
	);
	assert.deepEqual(digest?.stats, { count: 3, activeDays: 2, pending: 2 });
});

void test("digest lines match the weekly-review wire format", () => {
	const digest = buildWeekReview([note()], NOW);
	assert.equal(
		digest?.digest,
		"- 11-17 09:00 [待办>工作] (pending) 写周报 ｜ 把周报写完",
	);
});

void test("uncategorized notes fall back to 未分类, empty status omits the parens", () => {
	const digest = buildWeekReview([note({ category: "", status: "" })], NOW);
	assert.equal(
		digest?.digest,
		"- 11-17 09:00 [未分类] 写周报 ｜ 把周报写完",
	);
});

void test("long bodies are excerpted to 200 chars plus ellipsis", () => {
	const digest = buildWeekReview([note({ body: "a".repeat(300) })], NOW);
	assert.ok(digest?.digest.includes("｜ " + "a".repeat(200) + "…"));
	assert.ok(!digest?.digest.includes("a".repeat(201)));
});

void test("returns null when the window holds no notes", () => {
	assert.equal(buildWeekReview([note({ ctime: NOW - 30 * DAY })], NOW), null);
	assert.equal(buildWeekReview([], NOW), null);
});
