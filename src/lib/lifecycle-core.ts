/**
 * 生命周期纯层（票 09）：启动即主页的开关判定 + 卸载时要清的 body 级 class。
 * 只有判定与常量；真实的 open/close/cleanup 接线在 main.ts（不进测试）。
 */

export interface StartupToggle {
	/** 启动 Obsidian 后是否自动打开 Home 视图；undefined 视为开启。 */
	openOnStartup?: boolean;
}

export function shouldOpenOnStartup(s: StartupToggle): boolean {
	return s.openOnStartup !== false;
}

/** 插件可能挂到 body 上的全局 class（garden-dom.ts 写入）。卸载时全部清除。
 * home-v2 是 garden-dom 主动挂的 body 级标记；home-zen 平时只挂视图根
 * （host class），列在这里只为兜底 destroy() 的 remove 路径。 */
export const BODY_CLEANUP_CLASSES = ["home-v2", "home-zen"] as const;
