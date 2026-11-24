import { test } from "node:test";
import assert from "node:assert/strict";
import { callAIText, type RequestUrlLike } from "../src/lib/ai";

const ai = { apiUrl: "https://host/v1/chat/completions", apiKey: "k", model: "m" };

const ok = (content: string): RequestUrlLike => async (opts) => {
	return { status: 200, text: "", json: { choices: [{ message: { content } }] } };
};

void test("callAIText sends system+user messages without JSON response_format", async () => {
	let captured: Record<string, unknown> = {};
	const requestUrl: RequestUrlLike = async (opts) => {
		captured = { url: opts.url, headers: opts.headers, body: JSON.parse(opts.body) };
		return { status: 200, text: "", json: { choices: [{ message: { content: "# 回顾" } }] } };
	};
	const out = await callAIText(requestUrl, ai, { system: "sys", user: "usr" });
	assert.equal(out, "# 回顾");
	assert.equal(captured.url, ai.apiUrl);
	assert.equal((captured.headers as Record<string, string>).Authorization, "Bearer k");
	const body = captured.body as Record<string, unknown>;
	assert.deepEqual(body.messages, [
		{ role: "system", content: "sys" },
		{ role: "user", content: "usr" },
	]);
	assert.equal(body.model, "m");
	assert.equal(body.response_format, undefined);
});

void test("callAIText returns null and notices on HTTP failure", async () => {
	const seen: string[] = [];
	const out = await callAIText(
		async () => ({ status: 500, text: "boom", json: undefined }),
		ai,
		{ system: "s", user: "u", notice: (m) => seen.push(m) },
	);
	assert.equal(out, null);
	assert.ok(seen[0].includes("500"));
});

void test("callAIText returns null on network error", async () => {
	const seen: string[] = [];
	const out = await callAIText(
		async () => { throw new Error("offline"); },
		ai,
		{ system: "s", user: "u", notice: (m) => seen.push(m) },
	);
	assert.equal(out, null);
	assert.ok(seen[0].includes("offline"));
});

void test("callAIText returns null without a request when key is missing", async () => {
	let called = false;
	const out = await callAIText(
		async () => { called = true; return { status: 200, text: "", json: {} }; },
		{ ...ai, apiKey: "" },
		{ system: "s", user: "u" },
	);
	assert.equal(out, null);
	assert.equal(called, false);
});
