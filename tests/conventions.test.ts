import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONVENTIONS, resolveConventions } from "../src/lib/conventions";

test("defaults follow the vault's documented layout", () => {
	assert.deepEqual(DEFAULT_CONVENTIONS, {
		inboxDir: "Inbox",
		indexDir: "_Index",
		reviewsDir: "Reviews",
	});
});

test("resolves stored settings verbatim when complete", () => {
	const resolved = resolveConventions({
		inboxDir: "收集箱",
		indexDir: "索引",
		reviewsDir: "回顾",
	});
	assert.deepEqual(resolved, {
		inboxDir: "收集箱",
		indexDir: "索引",
		reviewsDir: "回顾",
	});
});

test("falls back to defaults per-field for partial or empty settings", () => {
	assert.deepEqual(resolveConventions({ inboxDir: "收集箱" }), {
		inboxDir: "收集箱",
		indexDir: "_Index",
		reviewsDir: "Reviews",
	});
	assert.deepEqual(resolveConventions({}), DEFAULT_CONVENTIONS);
});

test("trims stray whitespace from configured paths", () => {
	assert.equal(resolveConventions({ inboxDir: " Inbox " }).inboxDir, "Inbox");
});
