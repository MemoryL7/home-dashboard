import "./garden-dom"; // 保证默认渲染器已注册（渲染器模块 import 时自注册）
import {
	getBgRenderer,
	resolveBgId,
	type BgContext,
	type BgHandle,
} from "./bg-core";
import { BODY_CLEANUP_CLASSES } from "./lifecycle-core";
import { ZEN_BLANK_GUARD, zenToggle } from "./garden-scene";

/**
 * 背景通用宿主层（票 IKX1S2）：渲染器无关的检测与接线，只写这一次——
 * - 双击赏竹（ZEN_BLANK_GUARD 白名单 + zenToggle 状态机，命中白名单即非空白）；
 * - `--view-h` 测量与 ResizeObserver（窗口/布局变化同步视图实际高）；
 * - `prefers-reduced-motion` 探测（结论放进 BgContext，渲染器只消费）；
 * - body.home-v2 全局标记的增删（卸载兜底走 BODY_CLEANUP_CLASSES 单一来源）。
 * 渲染器只负责画；设置热切换 = 旧渲染器 destroy → 新渲染器挂载（home-view 调）。
 */

/** 挂载背景：host 是视图根（背景层须与卡片同一 backdrop 取样树，勿移出）。 */
export function mountBackground(host: HTMLElement, bgId: string): BgHandle {
	const resolved = resolveBgId(bgId);
	const ctx: BgContext = {
		reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
	};
	let renderer: BgHandle;
	try {
		renderer = getBgRenderer(resolved)(host, resolved, ctx);
	} catch (e) {
		// 渲染器抛错也回退默认渲染器，Home 页不因新实现开天窗
		console.error(`bg-host: 渲染器 ${resolved} 挂载失败，回退默认`, e);
		renderer = getBgRenderer("garden-svg")(host, "garden-svg", ctx);
	}

	/* —— 视图高度同步：把视图根的实际可视高写进 --view-h，供 .garden-svg /
	   .bg-fall 取用（替代 100vh，避免窗口高>视图高时把滚动高度撑到窗口高）。
	   挂载时测一次，布局/窗口变化随 RO 更新 —— */
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
		renderer.setZen(zen);
	};
	host.addEventListener("dblclick", onBlankDblClick);

	document.body.classList.add("home-v2");

	return {
		setZen(visible: boolean): void {
			zen = visible;
			host.classList.toggle("home-zen", zen);
			renderer.setZen(zen);
		},
		destroy(): void {
			viewRo.disconnect();
			host.removeEventListener("dblclick", onBlankDblClick);
			renderer.destroy();
			// remove 兜底清掉可能的历史残留：home-v2 随视图关闭摘除，不泄漏
			//（class 清单以 lifecycle-core 为单一来源，卸载兜底用同一份）
			document.body.classList.remove(...BODY_CLEANUP_CLASSES);
			host.classList.remove("home-zen");
			zen = false;
		},
	};
}
