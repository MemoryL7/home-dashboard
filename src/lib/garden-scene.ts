/**
 * 竹园场景的纯计算层：构图（三层景深竹园 SVG 规划）、飘叶位姿、竹丛摆动角度、
 * 赏竹显隐状态机、双缓冲竹园复用。
 *
 * 拆法（issue IKW6K9）：场景计算是时间/视口的纯函数，不触碰真实 DOM——SVG 节点
 * 通过注入的工厂创建（测试里是内存假节点），时间显式传入（rAF tick 的时间戳 /
 * 测试里的虚拟时间）。DOM 绑定在 garden-dom.ts，不进测试。
 *
 * 动效移植自 miaoziguan/obsidian-bamboo-immortals（Apache-2.0），
 * 与 Home.md v2 内联块同源。关键不变量（docs/agents/home-dashboard.md）：
 * - 连续运动全部是绝对时间的纯函数 + 每株固定参数（dur/amp/ph0 挂 dataset），
 *   节点重插后按当前时间续接相位，绝不从 0 重启（CSS animation 的"齐跳"即闪）。
 * - 竹园 SVG 跨渲染复用（getOrCreateGarden：移动而非重建），随机重画会让竹子
 *   肉眼可见地变形。
 */

/* ============ SVG 节点抽象（最小子集；测试提供内存实现） ============ */

export interface SceneNode {
	tag: string;
	attrs: Record<string, string>;
	style: Record<string, string>;
	dataset: Record<string, string>;
	children: SceneNode[];
	appendChild(child: SceneNode): SceneNode;
	setAttribute(k: string, v: string): void;
}

/** createElementNS 的等价物：按标签名产出新节点。 */
export type SceneNodeFactory = (tag: string) => SceneNode;

/* ============ 确定性随机（与 Home.md 同款 LCG，seed 固定 → 构图稳定） ============ */

export function makeRng(seed: number): () => number {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

/* ============ 竹园构图：丛生挺拔 · 竿节枝叶俱全 · 三层景深 ============ */

const VIEW_W = 1600;
const VIEW_H = 900;

const AGES = {
	old: { cBottom: "#6f7a44", cTop: "#a3a868", node: "#6e7842", leaves: ["#6f8a4f", "#8aa35e", "#5c7a42"] },
	mature: { cBottom: "#3f6449", cTop: "#6fa080", node: "#3d6a50", leaves: ["#2e5d43", "#3d6b4f", "#4a7d5e", "#588e63"] },
	young: { cBottom: "#639254", cTop: "#9cc284", node: "#5c8f62", leaves: ["#8bbf7a", "#9cc284", "#7fae6f", "#588e63"] },
};

function hexRgb(h: string): [number, number, number] {
	const v = parseInt(h.slice(1), 16);
	return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mix(h1: string, h2: string, t: number): [number, number, number] {
	const a = hexRgb(h1);
	const b = hexRgb(h2);
	return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as [number, number, number];
}

interface CulmOpts {
	x: number;
	h: number;
	w: number;
	segH: number;
	lean: number;
	bow: number;
	age: keyof typeof AGES;
	branches: boolean;
	midLeaf?: boolean;
	leafSize?: number;
	hue?: number;
	dy?: number;
}

/**
 * 构建整棵竹园 SVG（虚节点树）。同一 seed + 同一 opts 得到同一构图——DOM 层
 * 只在首次渲染调用它，之后靠 getOrCreateGarden 复用。
 */
export function buildGarden(
	rng: () => number,
	create: SceneNodeFactory,
	opts: { mobile?: boolean } = {},
): SceneNode {
	const mobile = opts.mobile === true;
	const pick = <T,>(a: readonly T[]): T => a[Math.floor(rng() * a.length)] as T;

	const svg = create("svg");
	svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
	svg.setAttribute("preserveAspectRatio", "xMidYMax slice");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("class", "garden-svg");

	const el = (tag: string, attrs: Record<string, string>, parent?: SceneNode): SceneNode => {
		const e = create(tag);
		for (const k in attrs) e.setAttribute(k, attrs[k]);
		(parent ?? svg).appendChild(e);
		return e;
	};

	const leaf = (g: SceneNode, x: number, y: number, deg: number, L: number, col: string): void => {
		const W = L * 0.22;
		const curl = rng() < 0.3;
		const lens = (LL: number, WW: number): string =>
			curl
				? `M0 0 Q${(LL * 0.35).toFixed(1)} ${(-WW * 0.8).toFixed(1)} ${LL.toFixed(1)} 0 Q${(LL * 0.3).toFixed(1)} ${(WW * 0.5).toFixed(1)} 0 0 Z`
				: `M0 0 Q${(LL * 0.42).toFixed(1)} ${(-WW).toFixed(1)} ${LL.toFixed(1)} 0 Q${(LL * 0.42).toFixed(1)} ${WW.toFixed(1)} 0 0 Z`;
		const lg = el("g", { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})` }, g);
		// 叶面颜色微抖动（±7），避免大片叶子同一个纯色
		const fill = `rgb(${hexRgb(col)
			.map((v) => Math.max(0, Math.min(255, Math.round(v + (rng() * 14 - 7)))))
			.join(",")})`;
		el("path", { d: lens(L, W), fill }, lg);
		// 内瓣：模拟叶片沿主脉的折面感
		el("path", { d: lens(L * 0.8, W * 0.42), fill: "rgba(12,32,20,0.15)" }, lg);
	};

	const leafCluster = (g: SceneNode, x: number, y: number, size: number, dir = 1): void => {
		const base = [-72, -38, -6, 28, 58];
		const cnt = 3 + Math.floor(rng() * 3);
		const start = Math.floor(rng() * (base.length - cnt + 1));
		for (let i = 0; i < cnt; i++) {
			const a = base[start + i] + (rng() * 24 - 12);
			const ang = dir < 0 ? 180 - a : a;
			const L = (42 + rng() * 26) * size;
			const ox = (rng() * 10 - 5) * size;
			const oy = (rng() * 8 - 4) * size;
			leaf(g, x + ox, y + oy, ang, L, rng() < 0.68 ? pick(AGES.mature.leaves) : pick([...AGES.mature.leaves, ...AGES.young.leaves]));
		}
	};

	const branch = (g: SceneNode, x: number, y: number, dir: number, len: number, size: number): void => {
		const mx = x + (dir * len * 0.5);
		const my = y - len * 0.22;
		const ex = x + dir * len;
		const ey = y + len * 0.12;
		el("path", { d: `M${x.toFixed(1)} ${y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`, fill: "none", stroke: "#4a7d5e", "stroke-width": "1.6", "stroke-linecap": "round" }, g);
		leafCluster(g, ex, ey, size, dir);
		if (rng() < 0.5) leafCluster(g, x + dir * len * 0.55, y - len * 0.05, size * 0.8, dir);
	};

	const crown = (g: SceneNode, p: { x: number; y: number }, size: number): void => {
		const cnt = 3 + Math.floor(rng() * 3);
		const allLeaf = [...AGES.mature.leaves, ...AGES.young.leaves];
		for (let i = 0; i < cnt; i++) {
			const side = rng() < 0.5 ? -1 : 1;
			const m = 15 + rng() * 75;
			const a = side > 0 ? m : 180 - m;
			const L = (34 + rng() * 20) * size;
			leaf(g, p.x + (rng() * 6 - 3), p.y - rng() * 6, a, L, rng() < 0.68 ? pick(AGES.mature.leaves) : pick(allLeaf));
		}
	};

	const culm = (g: SceneNode, o: CulmOpts): void => {
		const n = Math.max(5, Math.round(o.h / o.segH));
		const baseY = VIEW_H + (o.dy ?? 0); // 底部延伸出画面下缘，不见生硬截断
		const pts: { x: number; y: number; w: number }[] = [];
		for (let i = 0; i <= n; i++) {
			const t = i / n;
			pts.push({
				x: o.x + o.lean * t * t + o.bow * Math.sin(t * Math.PI),
				y: baseY - o.h * t,
				w: o.w * (1 - 0.42 * t),
			});
		}
		const age = AGES[o.age];
		const h = o.hue ?? 0;
		const tint = (rgb: [number, number, number]): string =>
			`rgb(${rgb.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (i === 0 ? h * 12 : i === 2 ? -h * 9 : 0))))).join(",")})`;
		const nodeTint = tint(hexRgb(age.node));
		const quad = (a: { x: number; w: number; y: number }, b: { x: number; w: number; y: number }, f1: number, f2: number, fill: string): void => {
			el("path", {
				d: `M${(a.x - a.w / 2 + a.w * f1).toFixed(1)} ${a.y.toFixed(1)} L${(a.x - a.w / 2 + a.w * f2).toFixed(1)} ${a.y.toFixed(1)} L${(b.x - b.w / 2 + b.w * f2).toFixed(1)} ${b.y.toFixed(1)} L${(b.x - b.w / 2 + b.w * f1).toFixed(1)} ${b.y.toFixed(1)} Z`,
				fill,
			}, g);
		};
		for (let i = 0; i < n; i++) {
			const a = pts[i];
			const b = pts[i + 1];
			quad(a, b, 0, 1, tint(mix(age.cBottom, age.cTop, (i + 0.5) / n)));
			quad(a, b, 0.0, 0.34, "rgba(15,35,20,0.05)");
			quad(a, b, 0.0, 0.24, "rgba(15,35,20,0.05)");
			quad(a, b, 0.0, 0.16, "rgba(15,35,20,0.05)");
			quad(a, b, 0.55, 0.97, "rgba(255,255,255,0.04)");
			quad(a, b, 0.6, 0.9, "rgba(255,255,255,0.05)");
			quad(a, b, 0.65, 0.84, "rgba(255,255,255,0.05)");
			quad(a, b, 0.68, 0.8, "rgba(255,255,255,0.05)");
		}
		for (let i = 1; i < n; i++) {
			const p = pts[i];
			el("rect", { x: (p.x - p.w * 0.62).toFixed(1), y: (p.y - 1.7).toFixed(1), width: (p.w * 1.24).toFixed(1), height: "3.4", rx: "1.7", fill: nodeTint }, g);
		}
		if (o.midLeaf) {
			// 竿身中段补一小簇叶：上半段枝叶全空时竿身不显秃
			const li = Math.max(2, Math.round(n * (0.38 + rng() * 0.24)));
			branch(g, pts[li].x, pts[li].y, rng() < 0.5 ? -1 : 1, 28 + rng() * 22, (o.leafSize ?? 1) * 0.72);
		}
		if (o.branches) {
			for (let i = Math.ceil(n * 0.45); i < n; i++) {
				if (rng() < 0.6) branch(g, pts[i].x, pts[i].y, rng() < 0.5 ? -1 : 1, 34 + rng() * 34, o.leafSize ?? 1);
			}
		}
		crown(g, pts[n], (o.leafSize ?? 1) * 0.8);
	};

	const clump = (layer: SceneNode, o: {
		x: number;
		h: number;
		w: number;
		segH: number;
		leafSize?: number;
		dy?: number;
		subs?: number;
		dim?: number;
	}): void => {
		const g = el("g", { class: "sway" }, layer);
		// 摆动参数挂 dataset（rAF 按绝对时间驱动）：ph0 固定初相，节点重插后续接
		g.dataset.dur = (8 + rng() * 6).toFixed(1); // 周期 s
		g.dataset.amp = (0.3 + rng() * 0.5).toFixed(2); // 摆幅 deg
		g.dataset.ph0 = (rng() * 2).toFixed(3); // 初相（0–2 个半周期，打散同步）

		const hue = rng() * 1.6 - 0.8;
		culm(g, {
			x: o.x, h: o.h, w: o.w, segH: o.segH,
			lean: rng() * 16 - 8, bow: rng() * 14 - 7,
			age: pick(["mature", "old", "young"]),
			branches: true, midLeaf: true,
			leafSize: o.leafSize ?? 1, hue, dy: o.dy ?? 0,
		});
		const nSub = o.subs !== undefined ? o.subs : rng() < 0.5 ? 1 : 2;
		for (let i = 0; i < nSub; i++) {
			const side = rng() < 0.5 ? -1 : 1;
			culm(g, {
				x: o.x + side * (o.w * (1.5 + rng() * 2.5)),
				h: o.h * (0.5 + rng() * 0.3),
				w: o.w * (0.5 + rng() * 0.25),
				segH: o.segH,
				lean: side * (10 + rng() * 22),
				bow: side * (6 + rng() * 10),
				age: rng() < 0.6 ? "young" : pick(["mature", "old", "young"]),
				branches: rng() < 0.7,
				midLeaf: true,
				leafSize: (o.leafSize ?? 1) * 0.85,
				hue: rng() * 1.6 - 0.8,
				dy: o.dy ?? 0,
			});
		}
	};

	const layerFar = el("g", { class: "layer-far" });
	const layerDistant = el("g", { class: "layer-distant" });
	const layerMid = el("g", { class: "layer-mid" });
	const layerNear = el("g", { class: "layer-near" });

	// 远景：极淡强模糊，铺出纵深底色（mobile 3 丛 / desktop 5 丛）
	for (let c = 0; c < (mobile ? 3 : 5); c++) {
		const g = el("g", {}, layerFar);
		const x = 60 + rng() * 1480;
		for (let s = 0; s < 2 + Math.floor(rng() * 2); s++) {
			culm(g, { x: x + s * (10 + rng() * 18), h: 280 + rng() * 150, w: 6 + rng() * 3, segH: 46, lean: rng() * 20 - 10, bow: rng() * 10 - 5, age: "mature", branches: false, dy: 30 });
		}
		leafCluster(g, x + 6, VIEW_H - (330 + rng() * 100), 0.7, rng() < 0.5 ? -1 : 1);
	}
	// 右侧远景竹：与左侧竹丛对角呼应；收在 x≈76%–90% 带内，slice 裁切下不贴右缘
	for (let c = 0; c < 3; c++) {
		const g = el("g", {}, layerDistant);
		const x = 1210 + c * 95 + rng() * 40;
		culm(g, { x, h: 340 + rng() * 120, w: 7 + rng() * 3, segH: 50, lean: rng() * 12 - 6, bow: rng() * 8 - 4, age: "mature", branches: false, dy: 40 });
		leafCluster(g, x + 4, VIEW_H - (300 + rng() * 80), 0.65, rng() < 0.5 ? -1 : 1);
	}
	// 中景：左两丛 + 右一丛（对角平衡）
	const midClumps: { r: [number, number]; subs: number }[] = [
		{ r: [325, 445], subs: 1 },
		{ r: [495, 625], subs: 0 },
		{ r: mobile ? [1240, 1380] : [1180, 1320], subs: 0 },
	];
	for (const c of midClumps) {
		clump(layerMid, { x: c.r[0] + rng() * (c.r[1] - c.r[0]), h: 430 + rng() * 160, w: 9 + rng() * 4, segH: 58, leafSize: 0.85, dy: 60, subs: c.subs });
	}
	// 近景：仅左缘一丛作"画框"，侧竿限 1 根，高度收在冠顶不被硬切
	clump(layerNear, { x: 145 + rng() * 50, h: 760 + rng() * 60, w: 14 + rng() * 4, segH: 68, leafSize: 1.05, dy: 80, subs: 1 });

	return svg;
}

/* ============ 双缓冲：竹园复用（移动而非重建） ============ */

/**
 * 缓存命中返回既有 svg（built:false），未命中才构建。DOM 层把返回的节点
 * appendChild 到新宿主即可——appendChild 语义是"移动"，不会种出第二棵竹园。
 */
export function getOrCreateGarden<T>(
	cache: { svg?: T },
	build: () => T,
): { svg: T; built: boolean } {
	if (cache.svg) return { svg: cache.svg, built: false };
	cache.svg = build();
	return { svg: cache.svg, built: true };
}

/* ============ 连续运动：绝对时间的纯函数 ============ */

/** 竹丛摆角：三角波（0→1→0）+ smoothstep，等价 infinite alternate。 */
export function swayAngle(tMs: number, durS: number, ampDeg: number, ph0: number): number {
	const c = (tMs / (durS * 1000) + ph0) % 2;
	const k = c < 1 ? c : 2 - c;
	const e = k * k * (3 - 2 * k);
	return ampDeg * (2 * e - 1);
}

export interface LeafCfg {
	/** 下落车道 x（视口宽度比例 0–1） */
	x0: number;
	/** 下落周期 s（>60s 极慢） */
	dur: number;
	/** 初相 0–1：配车道递增即成对角错落 */
	ph0: number;
	/** 横向摇摆 px */
	sway: number;
	/** 自转速率 deg/s */
	rot: number;
	/** 叶面颜色（车道/相位/颜色配对是构图的一部分，与 Home.md v2 同款） */
	col: string;
}

export interface LeafPose {
	x: number;
	y: number;
	rotDeg: number;
}

/** 飘叶位姿：下落 + 横摆 + 自转，全部为绝对时间的纯函数。 */
export function leafPose(tMs: number, cfg: LeafCfg, vw: number, vh: number): LeafPose {
	const tS = tMs / 1000;
	const p = (tS / cfg.dur + cfg.ph0) % 1; // 0→1 一个下落周期
	const y = -40 + p * (vh + 80);
	const x = cfg.x0 * vw + Math.sin(tS * 0.9 + cfg.ph0 * 6) * cfg.sway;
	const rot = (tS * cfg.rot * (cfg.ph0 > 0.5 ? -1 : 1) + cfg.ph0 * 360) % 360;
	return { x, y, rotDeg: rot };
}

/** Home.md v2 同款三车道：对角分布、让开 Logo 与侧栏区。 */
export const FALL_LEAVES: readonly LeafCfg[] = [
	{ x0: 0.34, dur: 96, ph0: 0.05, sway: 34, rot: 42, col: "#6f8a4f" },
	{ x0: 0.56, dur: 96, ph0: 0.38, sway: 48, rot: 58, col: "#588e63" },
	{ x0: 0.78, dur: 96, ph0: 0.71, sway: 62, rot: 74, col: "#7fae6f" },
];

/* ============ 赏竹显隐状态机 ============ */

/** 唯一入口是点击空白区域；非空白点击不改变状态。 */
export function zenToggle(zen: boolean, blankClick: boolean): boolean {
	return blankClick ? !zen : zen;
}

/** 空白点击白名单：命中任一选择器即不是空白（DOM 层用 closest 逐个试探）。 */
export const ZEN_BLANK_GUARD = [
	".dash-card",
	".cap-card",
	".review-card",
	".home-dashboard__placeholder",
	".side",
	".hd-header",
	"button",
	"a",
	"input",
	"textarea",
	"select",
] as const;
