/* ============================================================
   daylog-core —— 时间轴 (Day Log) 数据层深模块（ADR 0006）
   自 Scripts/daylog-core.js 原样迁入（票 05）：算法、序列化格式、
   08:00 绕日日界（ADR 0005 修订 2026-11-12）全部不变。
   48 个半小时格 ↔ 「时间 | 事件 | 类型」表格的序列化/反序列化、
   Inbox 日文件的读存，全部藏在本模块后面。
   「一天」自 08:00 起算至次日 0800：SLOTS 前 32 格为当天 08:00–24:00，
   后 16 格为次日凌晨 00:00–08:00，文件日期 = 起始日——跨日时段自然
   落到正确文件（凌晨 0-8 点记在「昨天」的日文件里）。
   interface（依赖注入，签名风格与 classify-core 一致，见 ADR 0004）：
     TYPES / TYPE_BY / SLOTS     活动五类常量与半小时格时刻表
     dayDate(nowMs) → date       「今天」的 daylog 日（08:00 日界，ADR 0005 修订）
     parse(raw) → rows           正文表格文本 → 行对象
     serialize(rows) → raw       行对象 → 正文表格文本
     read(app, date) → rows      读 Inbox/<date>.md（不存在返回 {}）
     save(app, date, rows)       写 Inbox/<date>.md（frontmatter type: daylog）
   本模块不碰 window / DOM / Notice，纯数据，Node 用假 app 可直接测
   （tests/daylog-core.test.ts）。写盘后的色带刷新是调用方的职责。
   唯一差别：Inbox 目录来自路径约定（票 02，可配置），read/save 以
   可选参 inboxDir 覆盖默认 'Inbox'。
   ============================================================ */

/** 活动五类之一：key 即表格「类型」列的取值。 */
export interface DaylogType {
	key: string;
	zh: string;
	color: string;
	tip: string;
}

/** 半小时格行：desc 事件文本，type 类型 key（'' = 未分类）。 */
export interface DaylogRow {
	desc: string;
	type: string;
}

/** daylog-core 读写触到的 vault 切片（adapter 即可，Node 用假对象可测）。 */
export interface DaylogApp {
	vault: {
		adapter: {
			read(path: string): Promise<string>;
			write(path: string, data: string): Promise<void>;
		};
	};
}

export interface DaylogCore {
	TYPES: DaylogType[];
	TYPE_BY: Record<string, DaylogType>;
	SLOTS: string[];
	PATH(date: string, inboxDir?: string): string;
	/** 「一天」自 08:00 起算（ADR 0005 修订）：8 点前仍算前一个 daylog 日。
	 *  2026-11 自视图层（daylog-view 的 daylogDayDate）收编——日界规则的两半
	 *  （SLOTS 槽序与日期回退）从此在同一模块里，不再靠注释约定两处同步。
	 *  入参 ms（本地时区解读），返回 'YYYY-MM-DD'；不引 moment，Node 可测。 */
	dayDate(nowMs: number): string;
	parse(raw: string): Record<string, DaylogRow>;
	serialize(rows: Record<string, DaylogRow>): string;
	read(app: DaylogApp, date: string, inboxDir?: string): Promise<Record<string, DaylogRow>>;
	save(
		app: DaylogApp,
		date: string,
		rows: Record<string, DaylogRow>,
		inboxDir?: string,
	): Promise<void>;
}

export const daylogCore: DaylogCore = (() => {
	const TYPES: DaylogType[] = [
		{ key: "quality", zh: "高质量工作", color: "#3e8e5f", tip: "主动投入、有产出、接近目标的工作" },
		{ key: "mandatory", zh: "必须工作", color: "#4a7fb5", tip: "不得不做、维持日常运转的事务" },
		{ key: "rest", zh: "休息", color: "#6f9a9a", tip: "真正恢复精力的放松" },
		{ key: "play", zh: "自由娱乐", color: "#d98e3f", tip: "享受当下、无负罪感的娱乐" },
		{ key: "proc", zh: "拖延", color: "#c05a5a", tip: "逃避正事的低质量消遣" },
	];
	const TYPE_BY: Record<string, DaylogType> = Object.fromEntries(TYPES.map((t) => [t.key, t]));
	const SLOTS = Array.from({ length: 48 }, (_, i) => {
		const hm = (n: number): string =>
			`${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
		// 自 08:00 绕日：i=0..31 覆盖 08:00→24:00（i=31 末点记作 24:00），i=32..47 为次日 00:00→08:00
		const s = (480 + i * 30) % 1440;
		const e = (480 + (i + 1) * 30) % 1440;
		return `${hm(s)}-${e === 0 ? "24:00" : hm(e)}`;
	});
	const PATH = (date: string, inboxDir = "Inbox"): string => `${inboxDir}/${date}.md`;

	// 08:00 日界：凌晨 0–8 点归属前一个 daylog 日（与 SLOTS 的后 16 格「次日凌晨」
	// 是同一条规则的两半，改这里必须连着 SLOTS 一起看）
	const dayDate = (nowMs: number): string => {
		const d = new Date(nowMs);
		if (d.getHours() < 8) d.setDate(d.getDate() - 1);
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, "0");
		const day = String(d.getDate()).padStart(2, "0");
		return `${y}-${m}-${day}`;
	};

	// 正文表格 ↔ 行对象：只序列化有内容（事件或类型）的行
	function parse(raw: string): Record<string, DaylogRow> {
		const rows: Record<string, DaylogRow> = {};
		for (const line of raw.split("\n")) {
			const m = line.match(/^\|\s*(\d{2}:\d{2}-\d{2}:\d{2})\s*\|\s*(.*?)\s*\|\s*(\w*)\s*\|/);
			if (m && SLOTS.includes(m[1])) rows[m[1]] = { desc: m[2], type: TYPE_BY[m[3]] ? m[3] : "" };
		}
		return rows;
	}
	function serialize(rows: Record<string, DaylogRow>): string {
		const lines = ["| 时间 | 事件 | 类型 |", "| --- | --- | --- |"];
		for (const slot of SLOTS) {
			const r = rows[slot];
			if (r && (r.desc || r.type)) lines.push(`| ${slot} | ${r.desc || ""} | ${r.type || ""} |`);
		}
		return lines.join("\n");
	}
	async function read(
		app: DaylogApp,
		date: string,
		inboxDir?: string,
	): Promise<Record<string, DaylogRow>> {
		try {
			return parse(await app.vault.adapter.read(PATH(date, inboxDir)));
		} catch {
			return {};
		}
	}
	async function save(
		app: DaylogApp,
		date: string,
		rows: Record<string, DaylogRow>,
		inboxDir?: string,
	): Promise<void> {
		const body = `---\ntype: daylog\ndate: ${date}\n---\n${serialize(rows)}\n`;
		await app.vault.adapter.write(PATH(date, inboxDir), body);
	}

	return { TYPES, TYPE_BY, SLOTS, PATH, dayDate, parse, serialize, read, save };
})();
