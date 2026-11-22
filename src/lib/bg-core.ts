/**
 * 背景渲染器「实现台」纯层（票 IKX1S2，spec IKX1QC）。
 * 只有接口形状、注册表与 id 解析；真实挂载接线在 bg-host.ts（DOM，不进测试），
 * 各渲染器在各自模块（garden-dom.ts 等）注册自己。
 */

/** 挂载上下文：通用检测层的结论（bg-host 探测一次，渲染器只消费）。 */
export interface BgContext {
	/** 系统开启「减少动态效果」（prefers-reduced-motion: reduce）。 */
	reduced: boolean;
}

/** 渲染器返回的句柄：赏竹显隐 + 统一退出（spec 的唯一新接口）。 */
export interface BgHandle {
	/** 双击空白切换赏竹时调用；渲染器自行决定如何呈现（暂停动效/淡出等）。 */
	setZen(visible: boolean): void;
	/** 视图关闭或设置热切换时调用：停 rAF、摘监听、摘自己创建的节点。 */
	destroy(): void;
}

/** 统一挂载接口：入参宿主元素、bgId 与上下文，返回句柄。 */
export type BgRenderer = (host: HTMLElement, bgId: string, ctx: BgContext) => BgHandle;

/** 默认渲染器：SVG 竹园（现状默认观感）。 */
export const DEFAULT_BG_ID = "garden-svg";

/** 设置页下拉的选项清单（新渲染器接入时在此追加一行）。 */
export interface BgOption {
	id: string;
	label: string;
}

export const BG_OPTIONS: readonly BgOption[] = [{ id: DEFAULT_BG_ID, label: "竹园 SVG" }];

/** 设置里的 bgId 只认注册过的选项；空/未知（含旧 data.json 残值）一律回默认，
 *  保证损坏值不会让 Home 页开天窗。 */
export function resolveBgId(bgId: string | undefined): string {
	return BG_OPTIONS.some((o) => o.id === bgId) ? (bgId as string) : DEFAULT_BG_ID;
}

/** 渲染器注册表：渲染器模块在 import 时自注册（bg-host 保证两者都被 import）。 */
const registry = new Map<string, BgRenderer>();

export function registerBgRenderer(id: string, renderer: BgRenderer): void {
	registry.set(id, renderer);
}

/** 分发：未知/未注册的 id 回退默认渲染器（如渲染模块加载失败、data.json 残值）。 */
export function getBgRenderer(bgId: string): BgRenderer {
	const hit = registry.get(bgId) ?? registry.get(DEFAULT_BG_ID);
	if (!hit) throw new Error(`bg-core: 渲染器未注册（${bgId}，默认 ${DEFAULT_BG_ID} 也缺失）`);
	return hit;
}
