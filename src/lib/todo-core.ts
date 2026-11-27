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
	/** 精力分面：deep / shallow；非待办或未分为空串。 */
	energy?: string;
	/** 紧迫度分面：now / soon / someday；非待办或未分为空串。 */
	urgency?: string;
}

/** 分面合法值与循环切换次序（点击徽标 deep→shallow→deep、now→soon→someday→now）。 */
export const ENERGY_CYCLE = ["deep", "shallow"] as const;
export const URGENCY_CYCLE = ["now", "soon", "someday"] as const;
export const nextEnergy = (v: string): string =>
	ENERGY_CYCLE[(ENERGY_CYCLE.indexOf(v as never) + 1) % ENERGY_CYCLE.length];
export const nextUrgency = (v: string): string =>
	URGENCY_CYCLE[(URGENCY_CYCLE.indexOf(v as never) + 1) % URGENCY_CYCLE.length];

/**
 * 状态机：status 生命周期（ADR 0008）pending → doing → done，旁路 dropped。
 * action 即目标状态（开始=doing / 暂停=pending / 完成=done / 放弃=dropped / 复原=pending）。
 * 非法流转（如 done→pending）返回 null，调用方不写盘。
 */
const TRANSITIONS: Record<string, Record<string, string>> = {
	pending: { doing: "doing", done: "done", dropped: "dropped" },
	doing: { pending: "pending", done: "done", dropped: "dropped" },
	dropped: { pending: "pending" },
};
export function transitStatus(status: string, action: string): string | null {
	return TRANSITIONS[status]?.[action] ?? null;
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

/** 活跃待办：pending + doing（「待办未完」与紧凑待办卡的口径），ctime 倒序。 */
export function activeTodos<T extends TodoItem>(pages: T[]): T[] {
	return pages
		.filter((p) => p.status === "pending" || p.status === "doing")
		.sort((a, b) => b.ctime - a.ctime);
}

/** 某状态且落在 nowMs 起 7 天窗内的条数（完成/放弃节奏共用）。 */
function statusInWeek<T extends TodoItem>(pages: T[], status: string, nowMs: number): number {
	const weekAgo = nowMs - 7 * 24 * 3600 * 1000;
	return pages.filter(
		(p) => p.status === status && (p.completed || p.ctime) >= weekAgo,
	).length;
}

/**
 * 放大视图的全部数据准备（ADR 0008）：分组 / 排序 / 统计条口径一次算好，
 * 视图只渲染。pending 按 urgency 三栏（非法值/空值归 someday 之前不入栏，见 urOf）。
 */
export interface TodoBoard<T extends TodoItem> {
	doing: T[];
	now: T[];
	soon: T[];
	someday: T[];
	done: T[];
	dropped: T[];
	stats: {
		doing: number;
		pending: number;
		doneWeek: number;
		droppedWeek: number;
		/** 深度占比：活跃待办中 energy=deep 的百分比（无活跃待办为 0）。 */
		deepPct: number;
	};
}

const byCtimeDesc = <T extends TodoItem>(a: T, b: T): number => b.ctime - a.ctime;

export function todoBoard<T extends TodoItem>(pages: T[], nowMs: number): TodoBoard<T> {
	const active = pages.filter((p) => p.status === "pending" || p.status === "doing");
	const doing = active.filter((p) => p.status === "doing").sort(byCtimeDesc);
	const pend = pages.filter((p) => p.status === "pending");
	const ur = (want: string): T[] =>
		pend.filter((p) => p.urgency === want).sort(byCtimeDesc);
	const done = pages
		.filter((p) => p.status === "done")
		.sort((a, b) => (b.completed || b.ctime) - (a.completed || a.ctime));
	const dropped = pages.filter((p) => p.status === "dropped").sort(byCtimeDesc);
	return {
		doing,
		now: ur("now"),
		soon: ur("soon"),
		someday: ur("someday"),
		done,
		dropped,
		stats: {
			doing: doing.length,
			pending: active.length - doing.length,
			doneWeek: statusInWeek(pages, "done", nowMs),
			droppedWeek: statusInWeek(pages, "dropped", nowMs),
			deepPct: active.length
				? Math.round((active.filter((p) => p.energy === "deep").length * 100) / active.length)
				: 0,
		},
	};
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
