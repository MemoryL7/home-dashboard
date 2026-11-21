import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildGarden,
	FALL_LEAVES,
	getOrCreateGarden,
	leafPose,
	makeRng,
	swayAngle,
	zenToggle,
	type SceneNode,
} from "../src/lib/garden-scene";

/** Minimal in-memory SceneNode mirroring the SVG subset garden-scene uses. */
function fakeNode(tag: string): SceneNode {
	const node: SceneNode = {
		tag,
		attrs: {},
		style: {},
		dataset: {},
		children: [],
		appendChild(child) {
			node.children.push(child);
			return child;
		},
		setAttribute(k, v) {
			node.attrs[k] = v;
		},
	};
	return node;
}

function collect(node: SceneNode, pred: (n: SceneNode) => boolean): SceneNode[] {
	const out: SceneNode[] = [];
	const walk = (n: SceneNode): void => {
		if (pred(n)) out.push(n);
		n.children.forEach(walk);
	};
	walk(node);
	return out;
}

/* ============ 绝对时间驱动不变量（飘叶 / 摆动） ============ */

const LEAF = { x0: 0.56, dur: 96, ph0: 0.38, sway: 48, rot: 58 };

test("leafPose: y 随虚拟时间单调前进，一个周期后回到起点", () => {
	const vh = 900;
	// 从本叶初相之后的"整周期窗口"起步（ph0=0.38 → 相位在 (1-0.38)*dur 处回卷）
	const startMs = (1 - LEAF.ph0) * LEAF.dur * 1000;
	let lastY = -Infinity;
	for (let t = startMs; t < startMs + LEAF.dur * 1000; t += 1000) {
		const { y } = leafPose(t, LEAF, 1600, vh);
		assert.ok(y > lastY, `y 应单调递增 t=${t}`);
		lastY = y;
	}
	const start = leafPose(0, LEAF, 1600, vh);
	const wrapped = leafPose(LEAF.dur * 1000, LEAF, 1600, vh);
	// 整周期后回到同一相位（x 因横摆正弦周期不同会有差异，但 y 必须一致）
	assert.equal(Math.round(wrapped.y), Math.round(start.y));
});

test("leafPose: 纯绝对时间函数——调用历史不影响结果（重渲染续相位）", () => {
	const t = 12345678;
	// 直接查询 vs 模拟逐帧推进后再查询：结果必须相同（rAF 停转/重渲染不重启相位）
	const direct = leafPose(t, LEAF, 1600, 900);
	for (let s = 0; s <= t; s += 16) leafPose(s, LEAF, 1600, 900); // 模拟逐帧推进
	assert.deepEqual(leafPose(t, LEAF, 1600, 900), direct); // 历史之后查询仍一致
});

test("leafPose: 同一时刻三车道对角错落（x0 顺序即 x 顺序）", () => {
	for (const t of [0, 30_000, 77_777, 200_000]) {
		const xs = FALL_LEAVES.map((c) => leafPose(t, c, 1600, 900).x);
		assert.ok(xs[0] < xs[1] && xs[1] < xs[2], `t=${t} 应保持对角次序: ${xs}`);
	}
});

test("swayAngle: 端点取 ±amp，且为纯时间函数（重插续相位不齐跳）", () => {
	const dur = 10, amp = 0.5, ph0 = 0;
	assert.ok(Math.abs(swayAngle(0, dur, amp, ph0) + amp) < 1e-6); // c=0 → 三角波起点 -amp
	assert.ok(Math.abs(swayAngle(dur * 1000, dur, amp, ph0) - amp) < 1e-6); // c=1 → +amp
	// 历史无关：直接跳查 == 逐帧推进后查询
	const t = 45678;
	const direct = swayAngle(t, dur, amp, ph0);
	for (let s = 0; s <= t; s += 16) swayAngle(s, dur, amp, ph0); // 模拟逐帧推进
	assert.equal(swayAngle(t, dur, amp, ph0), direct); // 历史之后查询仍一致
	// ph0 打散同步：初相不同的两株同一时刻角度不同（大概率不重合）
	assert.notEqual(
		swayAngle(t, dur, amp, 0.1),
		swayAngle(t, dur, amp, 0.9),
	);
});

/* ============ 竹园构图（三层景深） ============ */

test("buildGarden: 四层景深结构 + sway 摆动参数齐备", () => {
	const rng = makeRng(42);
	const svg = buildGarden(rng, fakeNode, { mobile: false });
	for (const cls of ["layer-far", "layer-distant", "layer-mid", "layer-near"]) {
		const hits = collect(svg, (n) => n.attrs["class"] === cls);
		assert.equal(hits.length, 1, `${cls} 应恰好一层`);
	}
	const sways = collect(svg, (n) => n.attrs["class"] === "sway");
	assert.ok(sways.length > 0);
	for (const g of sways) {
		assert.ok(Number(g.dataset.dur) > 0);
		assert.ok(Number(g.dataset.amp) > 0);
		assert.ok(Number(g.dataset.ph0) >= 0 && Number(g.dataset.ph0) < 2);
	}
});

test("buildGarden: 同种子同构图（确定性），desktop 远景 5 丛 / mobile 3 丛", () => {
	const countFar = (mobile: boolean): string => {
		const svg = buildGarden(makeRng(42), fakeNode, { mobile });
		const far = collect(svg, (n) => n.attrs["class"] === "layer-far")[0];
		return far.children.map((c) => JSON.stringify(c.attrs)).join("|");
	};
	assert.equal(countFar(true), countFar(true)); // 确定性
	assert.notEqual(countFar(true), countFar(false)); // 数量不同 → 构图不同
	const far = collect(
		buildGarden(makeRng(42), fakeNode, { mobile: false }),
		(n) => n.attrs["class"] === "layer-far",
	)[0];
	assert.equal(far.children.length, 5);
	const farM = collect(
		buildGarden(makeRng(42), fakeNode, { mobile: true }),
		(n) => n.attrs["class"] === "layer-far",
	)[0];
	assert.equal(farM.children.length, 3);
});

/* ============ 双缓冲：竹园复用（移动而非重建） ============ */

test("getOrCreateGarden: 只建一次，重渲染返回同一实例且不重画", () => {
	const cache: { svg?: SceneNode } = {};
	let builds = 0;
	const build = (): SceneNode => {
		builds++;
		return fakeNode("svg");
	};
	const first = getOrCreateGarden(cache, build);
	assert.equal(builds, 1);
	assert.ok(first.built);
	const second = getOrCreateGarden(cache, build);
	assert.equal(builds, 1, "缓存命中时不得重画（构图稳定不闪）");
	assert.ok(!second.built);
	assert.equal(second.svg, first.svg);
	// 「移动而非重建」：缓存的同一节点换入新宿主后仍是同一个节点
	// （appendChild 移动语义；DOM 层据此保证竹园纹丝不动）
	const host = fakeNode("div");
	host.appendChild(second.svg);
	const third = getOrCreateGarden(cache, build);
	assert.equal(third.svg, first.svg);
	assert.ok(host.children.includes(third.svg));
});

/* ============ 赏竹显隐状态机 ============ */

test("zenToggle: 空白点击切换，显隐状态迁移完整", () => {
	let zen = false;
	zen = zenToggle(zen, true);
	assert.equal(zen, true);
	zen = zenToggle(zen, true);
	assert.equal(zen, false);
	// 非空白点击不改变状态
	zen = zenToggle(zen, false);
	assert.equal(zen, false);
});

test("FALL_LEAVES: 三车道对角 + 颜色随构图配对（三叶三色）", () => {
	assert.equal(FALL_LEAVES.length, 3);
	for (let t = 0; t <= 100_000; t += 10_000) {
		const xs = FALL_LEAVES.map((c) => leafPose(t, c, 1600, 900).x);
		assert.ok(xs[0] < xs[1] && xs[1] < xs[2]);
	}
	assert.equal(new Set(FALL_LEAVES.map((f) => f.col)).size, 3);
});
