import { test } from "node:test";
import assert from "node:assert/strict";
import { isImagePath, resolveImportPath, sanitizeName } from "../src/lib/logo-core";

void test("isImagePath：常见图片扩展名", () => {
	assert.equal(isImagePath("Attachments/home.png"), true);
	assert.equal(isImagePath(".assets/a.JPG"), true);
	assert.equal(isImagePath("x/webp"), false);
	assert.equal(isImagePath("竹"), false);
});

void test("isImagePath：路径含点目录仍按扩展名判定", () => {
	assert.equal(isImagePath(".assets/logo.svg"), true);
});

void test("sanitizeName：替换非法字符与分隔符", () => {
	assert.equal(sanitizeName("my photo:v1.png"), "my photo-v1.png");
	assert.equal(sanitizeName("a/b\\c.png"), "a-b-c.png");
	assert.equal(sanitizeName("   "), "logo.png");
});

void test("resolveImportPath：空目录直接用原名", async () => {
	const seen: string[] = [];
	const p = await resolveImportPath(
		{ exists: async (x) => (seen.push(x), false) },
		".assets",
		"home.png",
	);
	assert.equal(p, ".assets/home.png");
});

void test("resolveImportPath：重名追加 -2/-3", async () => {
	const taken = new Set([".assets/logo.png", ".assets/logo-2.png"]);
	const p = await resolveImportPath(
		{ exists: async (x) => taken.has(x) },
		".assets",
		"logo.png",
	);
	assert.equal(p, ".assets/logo-3.png");
});

void test("resolveImportPath：容忍 dir 首尾斜杠与反斜杠", async () => {
	const p = await resolveImportPath(
		{ exists: async () => false },
		"/.assets\\/",
		"logo.png",
	);
	assert.equal(p, ".assets/logo.png");
});
