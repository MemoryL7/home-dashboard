import {
	buildGarden,
	FALL_LEAVES,
	getOrCreateGarden,
	makeRng,
	swayAngle,
	leafPose,
	type SceneNode,
} from "./garden-scene";
import {
	registerBgRenderer,
	type BgContext,
	type BgHandle,
	type BgRenderer,
} from "./bg-core";

/**
 * 竹园场景的 DOM 绑定层（issue IKW6K9 的「薄 DOM 绑定」，不进测试）。
 * 票 IKX1S2 起作为第一个背景渲染器接入统一挂载接口（bg-core）：本模块只做
 * 渲染器自己的事——
 * - 把纯层产出的虚节点/位姿接到真实 DOM 与真实 rAF 时钟上；
 * - 模块级缓存移动而非重建（不变量 2）。
 * 通用检测层（双击赏竹状态机、--view-h 测量与 ResizeObserver、
 * prefers-reduced-motion 探测、body.home-v2 标记）上收到 bg-host.ts，
 * 这里只消费 ctx.reduced，不再重复探测。
 */

const NS = "http://www.w3.org/2000/svg";

/** 模块级缓存：视图关闭再打开时同一棵竹园（移动而非重建，构图稳定不闪）。 */
const gardenCache: { svg?: Element } = {};

/** 真实 SVGElement 到 SceneNode 的最小适配（appendChild 的移动语义保持原样）。
 * attrs/children 仅在纯层的假节点里有意义，真实适配中留空（读写走原生 Element）。
 * 包装对象不是 Node：用 WeakMap 记录 wrapper→真实元素，appendChild 时取原生节点。 */
const rawEl = new WeakMap<SceneNode, SVGElement>();

function adapt(el: SVGElement): SceneNode {
	const node: SceneNode = {
		tag: el.tagName,
		attrs: {},
		style: el.style as unknown as Record<string, string>,
		dataset: el.dataset as unknown as Record<string, string>,
		children: [],
		appendChild: (child) => {
			const raw = rawEl.get(child);
			if (!raw) throw new Error("garden-dom: appendChild 收到非适配节点");
			el.appendChild(raw);
			return child;
		},
		setAttribute: (k, v) => el.setAttribute(k, v),
	};
	rawEl.set(node, el);
	return node;
}

/**
 * garden-svg 渲染器：三层景深背景（复用缓存的 svg）+ 飘叶 + 摆动 rAF。
 * host 需在卡片之下（z-index / DOM 顺序在前），卡片才能 backdrop-blur 到竹子；
 * 赏竹显隐由 bg-host 切视图根 class，渲染器的 setZen 只记录状态
 * （现观感纯 CSS，未来渲染器可在此暂停自己的动效）。
 */
export const renderGardenSvg: BgRenderer = (host, _bgId, ctx: BgContext): BgHandle => {
	/* —— 背景：缓存命中则移动复用，未命中才画（同一 seed，构图确定性） —— */
	const bg = host.createDiv({ cls: "bg-garden" });
	// sticky 的流位置必须是宿主第一个子节点（热切换时宿主里已有 .dash 等
	// 内容，createDiv 会追加到末尾，竹园会被钉到页面底部）——移回头部
	host.prepend(bg);
	const { svg } = getOrCreateGarden(gardenCache, () => {
		const svgEl = document.createElementNS(NS, "svg");
		// buildGarden 约定第一个 create("svg") 是根：直接路由到真实 svgEl，
		// 之后内容即原生挂在缓存节点上（纯移动，无二次移植）
		let rootTaken = false;
		buildGarden(
			makeRng(42),
			(tag) => {
				if (!rootTaken && tag === "svg") {
					rootTaken = true;
					return adapt(svgEl);
				}
				return adapt(document.createElementNS(NS, tag));
			},
			{ mobile: document.body.classList.contains("is-mobile") },
		);
		return svgEl;
	});
	bg.appendChild(svg);

	// 飘落竹叶：在竹园之上、卡片之下，不吃事件。
	// （Home.md v2 的 bg-glow 暖色渐变不搬：骨架期没有卡片压色，整页会蒙一层纱，
	// 观感像模糊遮罩；等卡片布局落地后再评估是否恢复）
	const fall = host.createDiv({ cls: "bg-fall" });
	const leafEls: HTMLElement[] = FALL_LEAVES.map((f) => {
		const sp = fall.createDiv({ cls: "fall-leaf" });
		// 逐节点拼 SVG（不用 innerHTML——插件市场审核禁止字符串注入 DOM）
		const svg = document.createElementNS(NS, "svg");
		svg.setAttribute("width", "44");
		svg.setAttribute("height", "18");
		svg.setAttribute("viewBox", "0 0 44 18");
		const path = document.createElementNS(NS, "path");
		path.setAttribute("d", "M2 9 Q 15 1.5 42 9 Q 15 16.5 2 9 Z");
		path.setAttribute("fill", f.col);
		svg.appendChild(path);
		sp.appendChild(svg);
		return sp;
	});

	/* —— rAF 驱动：摆动 + 飘叶，全部绝对时间纯函数（garden-scene 提供） —— */
	// svg 短暂离树时跳过写样式但保持循环（退出只走 destroy()，不在循环里
	// 自停——自停后无法重启会让重挂的场景永久冻结）
	const swayEls = Array.from(svg.querySelectorAll<SVGElement>(".sway"));
	let rafId = 0;
	const tick = (t: number): void => {
		if (svg.isConnected) {
			for (const g of swayEls) {
				const deg = swayAngle(t, Number(g.dataset.dur), Number(g.dataset.amp), Number(g.dataset.ph0));
				g.style.transform = `rotate(${deg.toFixed(3)}deg)`;
			}
			const vw = host.clientWidth || window.innerWidth;
			const vh = host.clientHeight || window.innerHeight;
			for (let i = 0; i < leafEls.length; i++) {
				const pose = leafPose(t, FALL_LEAVES[i], vw, vh);
				leafEls[i].style.transform =
					`translate(${pose.x.toFixed(1)}px,${pose.y.toFixed(1)}px) rotate(${pose.rotDeg.toFixed(1)}deg)`;
			}
		}
		rafId = requestAnimationFrame(tick);
	};
	if (!ctx.reduced) rafId = requestAnimationFrame(tick);

	return {
		// 竹园的赏竹观感纯 CSS（bg-host 切视图根 class），渲染器侧无动效可暂停；
		// 未来如需 JS 侧淡出/停帧，在此接线
		setZen(_visible: boolean): void {},
		destroy(): void {
			if (rafId) cancelAnimationFrame(rafId);
			bg.remove();
			fall.remove();
		},
	};
};

registerBgRenderer("garden-svg", renderGardenSvg);
