// prompts 轻断言（IKY82E Testing Decisions）：规则关键词存在/不存在。
// prompt 是纯字符串，断言其包含关键决策词，防规则被无意改丢。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CLASSIFY_PROMPT, DEFAULT_REVIEW_PROMPT } from "../src/lib/prompts";

void test("classify prompt has 8-domain reference list (soft convergence)", () => {
	assert.ok(DEFAULT_CLASSIFY_PROMPT.includes("工作/生活/学习/健康/财务/兴趣/社交/其他"));
	assert.ok(DEFAULT_CLASSIFY_PROMPT.includes("优先选清单内"));
});

void test("classify prompt bans form-word categories (ADR 0007)", () => {
	assert.ok(DEFAULT_CLASSIFY_PROMPT.includes("禁止用"));
	assert.ok(DEFAULT_CLASSIFY_PROMPT.includes("待办"));
});

void test("classify prompt judges energy/urgency for todos only", () => {
	assert.ok(DEFAULT_CLASSIFY_PROMPT.includes("energy"));
	assert.ok(DEFAULT_CLASSIFY_PROMPT.includes("urgency"));
	assert.ok(DEFAULT_CLASSIFY_PROMPT.includes("仅当状态为待办时判定"));
});

void test("classify prompt status rule keys on intent words, not category", () => {
	assert.ok(DEFAULT_CLASSIFY_PROMPT.includes("意图词"));
	assert.ok(!DEFAULT_CLASSIFY_PROMPT.includes("大类为\"待办\""));
});

void test("review prompt tells the author about new fields", () => {
	for (const word of ["doing", "dropped", "deep", "shallow", "now", "soon", "someday", "related"]) {
		assert.ok(DEFAULT_REVIEW_PROMPT.includes(word), `review prompt should mention ${word}`);
	}
});
