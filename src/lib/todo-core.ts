/* ============================================================
   todo-core —— 待办策略纯函数（待办是页面数据的口径知识）：
   - 什么算待办（status === 'pending'，按创建时间倒序）
   - 本周已完成（优先 completed 完成时刻，旧数据回退 ctime，7 天窗）
   - related → 跟进目标解析（wikilink / TFile path 两种形态）
   - 跟进计数（一遍摊平，待办行右侧「N条跟进」的口径）
   纯数据进出，不碰 DOM/Notice/vault——Node 直测（tests/todo-core.test.ts）。
   视图层（todo-view）只做渲染与事件接线。
   ============================================================ */

/** 待办策略用到的页面切片（InboxPage 的结构子集，视图侧 TodoPageLike 同形）。 */
export interface TodoItem {
	name: string;
	ctime: number;
	status: string;
	related: unknown;
	/** 完成时刻（ms）；旧数据无此字段为 0。 */
	completed: number;
}

/**
 * 纯：related frontmatter → 关联目标名列表（自 Home.md relatedTargets 迁入，
 * 原 todo-view 持有）。两种形态：字符串 "[[名]]"（可带别名/子路径）与
 * { path } 对象（TFile 引用）。
 */
export function relatedTargets(fmRelated: unknown): string[] {
	const arr = Array.isArray(fmRelated) ? fmRelated : [fmRelated];
	const out: string[] = [];
	for (const r of arr) {
		if (!r) continue;
		if (typeof r === "string") {
			const m = r.match(/\[\[([^\]|#]+)/);
			if (m) out.push(m[1].replace(/\.md$/, "").trim());
		} else if (typeof r === "object" && r !== null && "path" in r) {
			const p = String((r as { path: unknown }).path)
				.replace(/\.md$/, "")
				.split("/")
				.pop();
			if (p) out.push(p);
		}
	}
	return out;
}

/** 待办列表：status === 'pending'，按创建时间倒序（新在上）。 */
export function pendingTodos<T extends TodoItem>(pages: T[]): T[] {
	return pages
		.filter((p) => p.status === "pending")
		.sort((a, b) => b.ctime - a.ctime);
}

/** 本周已完成条数：status done 且（完成时刻，回退 ctime）落在 nowMs 起 7 天内。 */
export function doneInWeek<T extends TodoItem>(pages: T[], nowMs: number): number {
	const weekAgo = nowMs - 7 * 24 * 3600 * 1000;
	return pages.filter(
		(p) => p.status === "done" && (p.completed || p.ctime) >= weekAgo,
	).length;
}

/**
 * 跟进计数：一遍摊平所有页面的 related，得到 待办名 → 跟进条数。
 * 待办行的「N条跟进」以此查表（替代原来逐行的 O(n²) filter）。
 */
export function followupCounts<T extends { name: string; related: unknown }>(
	pages: T[],
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const p of pages) {
		for (const t of relatedTargets(p.related)) {
			out[t] = (out[t] || 0) + 1;
		}
	}
	return out;
}

/** 跟进条目（详情弹窗列表用）：related 指向目标的页面切片。 */
export interface FollowupItem {
	path: string;
	name: string;
	ctime: number;
	summary: string;
}

/** 纯：related 指向 targetName 的页面 → 跟进条目，按创建时间正序（先记在上）。 */
export function followupsFor<T extends FollowupItem & { related: unknown }>(
	pages: T[],
	targetName: string,
): T[] {
	return pages
		.filter((p) => relatedTargets(p.related).includes(targetName))
		.sort((a, b) => a.ctime - b.ctime);
}

/** 纯：笔记原文 → 去掉 frontmatter 的正文（详情弹窗展示用）；无 fm 原样返回。 */
export function stripFrontmatter(raw: string): string {
	const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	return m ? raw.slice(m[0].length) : raw;
}
