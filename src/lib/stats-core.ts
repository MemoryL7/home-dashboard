/* ============================================================
   stats-core —— 统计纯函数（连续天数/最长连击/计数/标签频次）
   自 Scripts/stats-core.js 原样迁入（票 04）：算法与口径不变。
   此前「连续天数」在速览卡与记录热力两处各写了一遍循环（近似
   拷贝），收敛于此。moment 不进本模块：日期一律传 'YYYY-MM-DD'
   字符串，内部按 UTC 天做日差运算，Node 可测。
   2026-11 收编散落在视图层的聚合口径：按天计数（速览/打卡/热力/
   页头胶囊四处共用）、ISO 周起点、热力色阶、今日洞察文案。
   interface: statsCore() -> { streak, bestStreak, countBy, tagFreq,
                               dayCounts, weekStart, heatmapLevel, domainKey, insightText }
   ============================================================ */

/** 一天的键：'YYYY-MM-DD'。 */
export type DayKey = string;

export interface StatsCore {
	/** 连续天数：从 today 起往前数（今天没记则从昨天起数），days 为 'YYYY-MM-DD' 可迭代 */
	streak(days: Iterable<DayKey>, today: DayKey): number;
	/** 最长连击：排序后相邻日差恰为 1 天的连续段最长长度 */
	bestStreak(days: Iterable<DayKey>): number;
	/** 按键计数：items → { key: n }，空键（无大类等）跳过——大类分布 / 覆盖大类共用 */
	countBy<T>(items: T[], keyOf: (item: T) => unknown): Record<string, number>;
	/** 标签频次：pages 的 tags 摊平计数 */
	tagFreq(pages: { tags?: string[] }[]): Record<string, number>;
	/** 按天计数：items → { 'YYYY-MM-DD': n }（时间戳与格式化由调用方注入，moment 不进本模块） */
	dayCounts<T>(items: T[], tsOf: (item: T) => number, fmt: (ms: number) => DayKey): Record<string, number>;
	/** ISO 周起点：nowMs 同一时刻回退到本周周一（本地时区）的 ms——本周打卡条的起点 */
	weekStart(nowMs: number): number;
	/** 热力色阶：0 → 0；≤1 → 1；≤3 → 2；≤5 → 3；其余 → 4 */
	heatmapLevel(n: number): number;
	/** 领域归行键（ADR 0007）：待办条目按中类归行（历史形态类目防御：空则「未分」）；其余按大类，空则「未分类」 */
	domainKey(p: { category: string; subcategory?: string }): string;
	/** 今日洞察文案：近 7 天条数 + 占比最高的领域 + 连续天数（纯本地推导） */
	insightText(pages: { ctime: number; category: string; subcategory?: string }[], streak: number, nowMs: number): string;
}

export function statsCore(): StatsCore {
	const DAY = 86400000;
	const utc = (s: DayKey): number => {
		const [y, m, d] = s.split("-").map(Number);
		return Date.UTC(y, m - 1, d);
	};
	const fmt = (ms: number): DayKey => new Date(ms).toISOString().slice(0, 10);
	// 连续天数：从 today 起往前数（今天没记则从昨天起数），days 为 'YYYY-MM-DD' 可迭代
	const streak = (days: Iterable<DayKey>, today: DayKey): number => {
		const set = new Set(days);
		let cur = utc(today);
		if (!set.has(today)) cur -= DAY;
		let n = 0;
		while (set.has(fmt(cur))) {
			n++;
			cur -= DAY;
		}
		return n;
	};
	// 最长连击：排序后相邻日差恰为 1 天的连续段最长长度
	const bestStreak = (days: Iterable<DayKey>): number => {
		const ds = [...new Set(days)].map(utc).sort((a, b) => a - b);
		let best = 0,
			run = 0,
			prev: number | null = null;
		for (const t of ds) {
			run = prev !== null && t - prev === DAY ? run + 1 : 1;
			if (run > best) best = run;
			prev = t;
		}
		return best;
	};
	// 按键计数：items → { key: n }，空键（无大类等）跳过——大类分布 / 覆盖大类共用
	const countBy = <T>(
		items: T[],
		keyOf: (item: T) => unknown,
	): Record<string, number> => {
		const out: Record<string, number> = {};
		for (const it of items) {
			const k = keyOf(it);
			if (!k) continue;
			out[k as string] = (out[k as string] || 0) + 1;
		}
		return out;
	};
	// 标签频次：pages 的 tags 摊平计数
	const tagFreq = (pages: { tags?: string[] }[]): Record<string, number> => {
		const freq: Record<string, number> = {};
		for (const p of pages) for (const t of p.tags || []) freq[t] = (freq[t] || 0) + 1;
		return freq;
	};
	// 按天计数：速览/打卡/热力/页头胶囊共用一份（原 stats-view 视图内循环收敛于此）
	const dayCounts = <T>(
		items: T[],
		tsOf: (item: T) => number,
		fmt: (ms: number) => DayKey,
	): Record<string, number> => {
		const counts: Record<string, number> = {};
		for (const it of items) {
			const k = fmt(tsOf(it));
			counts[k] = (counts[k] || 0) + 1;
		}
		return counts;
	};
	// ISO 周起点：同一时刻回退到周一（原 weekStart.subtract(isoWeekday-1) 等价实现，
	// 保留时刻部分，视图侧拿 ms 包 moment 后 add(i,'day') 走 DST 安全的日加法）
	const weekStart = (nowMs: number): number => {
		const d = new Date(nowMs);
		const iso = d.getDay() === 0 ? 7 : d.getDay();
		return new Date(
			d.getFullYear(),
			d.getMonth(),
			d.getDate() - (iso - 1),
			d.getHours(),
			d.getMinutes(),
			d.getSeconds(),
			d.getMilliseconds(),
		).getTime();
	};
	// 热力色阶（沿用 hm-cell lv0–lv4）
	const heatmapLevel = (n: number): number =>
		n === 0 ? 0 : n <= 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
	// 领域归行键：待办类目是形态不是领域，按中类归行（ADR 0007）；
	// 历史数据防御：待办无中类归「未分」，无大类归「未分类」
	const domainKey = (p: { category: string; subcategory?: string }): string =>
		p.category === "待办" ? (p.subcategory || "未分") : p.category || "未分类";
	// 今日洞察文案（原 stats-view 底部的 insightText，moment 未用到故不入参）
	const insightText = (
		pages: { ctime: number; category: string; subcategory?: string }[],
		streak: number,
		nowMs: number,
	): string => {
		const weekAgo = nowMs - 7 * 24 * 3600 * 1000;
		const recent = pages.filter((p) => p.ctime >= weekAgo);
		if (!recent.length) {
			return "近 7 天还没有随手记，落一笔开始这一周的观察 🎋";
		}
		const byCat = countBy(recent, domainKey);
		const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
		const pct = Math.round((top[1] * 100) / recent.length);
		return `近 7 天共记 ${recent.length} 条，「${top[0]}」占比 ${pct}%；已连续记录 ${streak} 天，保持节奏 🎋`;
	};
	return { streak, bestStreak, countBy, tagFreq, dayCounts, weekStart, heatmapLevel, domainKey, insightText };
}
