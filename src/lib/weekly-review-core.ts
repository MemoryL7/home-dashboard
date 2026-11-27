/* ============================================================
   weekly-review-core —— 周回顾的本地段（票 08）。纯函数：吃随手记
   快照 + 当前时刻，产出窗口内清单、本地统计与 API 摘要串。AI 调用
   与落盘是运行时薄壳（main.ts 命令），不在这里。
   口径与 Scripts/weekly-review.js 一致：
   - 近 7 天（按 ctime，注入 nowMs，不依赖时钟）
   - 摘要行格式 `- MM-DD HH:mm [大类] (status) 摘要 ｜ 原文节选`
   - 原文超 200 字截断加省略号
   ============================================================ */

/** 一条进入周回顾的随手记。date 由调用方用 moment 预格式化。 */
export interface WeekNote {
	ctime: number;
	date: string;
	/** 已拼好的 `大类>中类>小类`，空串视为未分类。 */
	category: string;
	summary: string;
	status: string;
	/** 原文（core 负责截断）。 */
	body: string;
}

export interface WeekStats {
	count: number;
	activeDays: number;
	pending: number;
}

export interface WeekDigest {
	notes: WeekNote[];
	stats: WeekStats;
	/** 发给 AI 的清单串；空窗口时整个结果为 null，不产空串。 */
	digest: string;
}

const BODY_LIMIT = 200;

/**
 * 纯：随手记快照 → 近 `days` 天的清单 + 统计 + AI 摘要串。
 * 无窗口内记录时返回 null（调用方据此提示「无可回顾」）。
 */
export function buildWeekReview(
	notes: WeekNote[],
	nowMs: number,
	days = 7,
): WeekDigest | null {
	const since = nowMs - days * 24 * 60 * 60 * 1000;
	const inWindow = notes
		.filter((n) => n.ctime > since)
		.sort((a, b) => a.ctime - b.ctime);
	if (inWindow.length === 0) return null;

	const activeDays = new Set(inWindow.map((n) => n.date.slice(0, 5))).size;
	const pending = inWindow.filter((n) => n.status === "pending" || n.status === "doing").length;
	const digest = inWindow
		.map((n) => {
			let body = n.body;
			if (body.length > BODY_LIMIT) body = body.slice(0, BODY_LIMIT) + "…";
			return `- ${n.date} [${n.category || "未分类"}]${
				n.status ? ` (${n.status})` : ""
			} ${n.summary} ｜ ${body}`;
		})
		.join("\n");

	return {
		notes: inWindow,
		stats: { count: inWindow.length, activeDays, pending },
		digest,
	};
}
