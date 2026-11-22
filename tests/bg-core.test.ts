import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BG_OPTIONS,
	DEFAULT_BG_ID,
	getBgRenderer,
	registerBgRenderer,
	resolveBgId,
	type BgContext,
	type BgHandle,
	type BgRenderer,
} from "../src/lib/bg-core";

/** 造一个只记录调用痕迹的假渲染器（不碰 DOM）。 */
function fakeRenderer(tag: string): { renderer: BgRenderer; calls: string[] } {
	const calls: string[] = [];
	const renderer: BgRenderer = (host, bgId, ctx) => {
		calls.push(`${tag}:${bgId}:${ctx.reduced}:${(host as { id?: string }).id ?? "?"}`);
		const handle: BgHandle = {
			setZen: (visible) => calls.push(`${tag}:zen:${visible}`),
			destroy: () => calls.push(`${tag}:destroy`),
		};
		return handle;
	};
	return { renderer, calls };
}

void test("resolveBgId: 空值/未知值/残值一律回默认，已知值原样通过", () => {
	assert.equal(resolveBgId(undefined), DEFAULT_BG_ID);
	assert.equal(resolveBgId(""), DEFAULT_BG_ID);
	assert.equal(resolveBgId("canvas-2d"), DEFAULT_BG_ID); // 未上线的实现
	assert.equal(resolveBgId(DEFAULT_BG_ID), DEFAULT_BG_ID);
});

void test("BG_OPTIONS: 默认选项是竹园 SVG 且唯一", () => {
	assert.deepEqual(BG_OPTIONS, [{ id: DEFAULT_BG_ID, label: "竹园 SVG" }]);
});

void test("注册表分发：按 bgId 调到对应渲染器，入参原样透传", () => {
	const a = fakeRenderer("a");
	registerBgRenderer("test-a", a.renderer);
	const host = { id: "h1" } as unknown as HTMLElement;
	const ctx: BgContext = { reduced: true };
	const handle = getBgRenderer("test-a")(host, "test-a", ctx);
	assert.deepEqual(a.calls, ["a:test-a:true:h1"]);
	handle.setZen(true);
	handle.destroy();
	assert.deepEqual(a.calls.slice(1), ["a:zen:true", "a:destroy"]);
});

void test("分发回退：未注册的 id 落到默认渲染器（渲染模块缺失/失败兜底）", () => {
	const g = fakeRenderer("g");
	registerBgRenderer(DEFAULT_BG_ID, g.renderer);
	const renderer = getBgRenderer("webgl-unknown");
	renderer({} as HTMLElement, "webgl-unknown", { reduced: false });
	assert.deepEqual(g.calls, ["g:webgl-unknown:false:?"]);
});
