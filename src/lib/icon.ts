/* ============================================================
   icon —— 图标工具：统一用 Obsidian 内置的 Lucide 线性图标
   （setIcon，与 lucide.dev 同一套图形），单色继承文字颜色。
   插件不能引外部 CDN 脚本（CSP / 离线），故不加载 lucide 包。
   ============================================================ */
import { setIcon } from "obsidian";

/** 图标默认尺寸：卡片标题行 16px；按钮内 14px。 */
export const ICON_TITLE = 16;
export const ICON_BTN = 14;

/**
 * 在 parent 末尾插入一个 Lucide 图标（线稿、currentColor）。
 * 放在文字前方调用；间距由 .dash-icon 的 margin-right 提供。
 */
export function putIcon(parent: HTMLElement, name: string, size: number): HTMLElement {
	const el = parent.createSpan({ cls: "dash-icon" });
	el.setAttr("aria-hidden", "true");
	el.style.setProperty("--icon-size", `${size}px`);
	// 尺寸交给 .dash-icon svg 的 CSS（--icon-size），setIcon 不设内联宽高
	setIcon(el, name);
	return el;
}
