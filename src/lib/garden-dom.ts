import {
	buildGarden,
	FALL_LEAVES,
	getOrCreateGarden,
	makeRng,
	swayAngle,
	leafPose,
	ZEN_BLANK_GUARD,
	zenToggle,
	type SceneNode,
} from "./garden-scene";
import { BODY_CLEANUP_CLASSES } from "./lifecycle-core";

/**
 * 竹园场景的 DOM 绑定层（issue IKW6K9 的「薄 DOM 绑定」，不进测试）。
 * 场景计算全部在 garden-scene.ts（纯函数）；这里只做：
 * - 把纯层产出的虚节点/位姿接到真实 DOM 与真实 rAF 时钟上；
 * - 赏竹显隐的点击接线（状态机本身在纯层）；
 * - body.home-v2 / home-zen 全局标记的增删（不泄漏）。
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

export interface GardenMount {
	/** 视图关闭时调用：停 rAF、摘点击监听、摘 body 全局标记。 */
	destroy(): void;
}

/**
 * 挂载竹园场景：三层景深背景（复用缓存的 svg）+ 飘叶 + 摆动 rAF + 赏竹点击。
 * host 需在卡片之下（z-index / DOM 顺序在前），卡片才能 backdrop-blur 到竹子。
 */
export function mountGarden(host: HTMLElement): GardenMount {
	/* —— 背景：缓存命中则移动复用，未命中才画（同一 seed，构图确定性） —— */
	const bg = host.createDiv({ cls: "bg-garden" });
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
		sp.innerHTML = `<svg width="44" height="18" viewBox="0 0 44 18"><path d="M2 9 Q 15 1.5 42 9 Q 15 16.5 2 9 Z" fill="${f.col}"/></svg>`;
		return sp;
	});

	/* —— rAF 驱动：摆动 + 飘叶，全部绝对时间纯函数（garden-scene 提供） —— */
	// 与 Home.md v2 不同处：插件视图没有 Dataview 重跑清空容器的问题，
	// 因此不需要「空帧守护」MutationObserver（home-dashboard.md 不变量 4 的
	// 有意分歧）；双缓冲复用只保留「竹园缓存移动而非重建」这一半。
	const swayEls = Array.from(svg.querySelectorAll(".sway")) as SVGElement[];
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	let rafId = 0;
	const tick = (t: number): void => {
		// svg 短暂离树时跳过写样式但保持循环（视图关闭走 destroy() 停转，不在
		// 循环里自停——自停后无法重启会让重挂的场景永久冻结）
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
	if (!reduced) rafId = requestAnimationFrame(tick);

	/* —— 视图高度同步：把 host 的实际可视高写进 --view-h，供 .garden-svg /
	   .bg-fall 取用（替代 100vh，避免窗口高>视图高时把滚动高度撑到窗口高、
	   内容不满一屏也出滚动条）。挂载时测一次，布局/窗口变化随 RO 更新 —— */
	const syncViewH = (): void => {
		const h = host.clientHeight;
		if (h > 0) host.style.setProperty("--view-h", `${h}px`);
	};
	syncViewH();
	const viewRo = new ResizeObserver(syncViewH);
	viewRo.observe(host);

	/* —— 赏竹显隐：唯一入口是双击空白区域（单击易误触；状态机在纯层 zenToggle） —— */
	let zen = false;
	const onBlankDblClick = (e: MouseEvent): void => {
		const target = e.target as Element | null;
		if (!target) return;
		for (const sel of ZEN_BLANK_GUARD) {
			if (target.closest(sel)) return; // 卡片/按钮等命中白名单即非空白
		}
		zen = zenToggle(zen, true);
		// 显隐只作用于本视图根（host class）；不挂 body 级标记，避免样式泄漏
		host.classList.toggle("home-zen", zen);
	};
	host.addEventListener("dblclick", onBlankDblClick);

	document.body.classList.add("home-v2");

	return {
		destroy(): void {
			if (rafId) cancelAnimationFrame(rafId);
			viewRo.disconnect();
			host.removeEventListener("dblclick", onBlankDblClick);
			// remove 兜底清掉可能的历史残留：home-v2 随视图关闭摘除，不泄漏
			//（class 清单以 lifecycle-core 为单一来源，卸载兜底用同一份）
			document.body.classList.remove(...BODY_CLEANUP_CLASSES);
			host.classList.remove("home-zen");
			zen = false;
		},
	};
}
