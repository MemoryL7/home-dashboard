/* ============================================================
   stats-view —— 侧栏个人面板（速览/打卡/洞察/大类/热力）+
   最近新增 feed（票 04 的双列布局版）。数据来自 collectInbox
   （vault API + metadataCache，不依赖 Dataview），口径全部来自
   statsCore（按天计数/ISO 周起点/热力色阶/洞察文案——2026-11
   自本文件收敛进 core）。本文件只做渲染。
   ============================================================ */
import { statsCore } from "./stats-core";
import { collectInbox, type InboxPage } from "./inbox-query";
import { putIcon, ICON_TITLE } from "./icon";
import { enableDragScroll } from "./drag-scroll";
import type { Moment } from "moment";

/** moment 的最小切片（Node 测试只传日期格式化桩）。 */
export type MomentLike = (input?: unknown) => Moment;

/**
 * 侧栏个人面板（一张连贯卡内的模块序列，模块间分隔线由 CSS 画）：
 * 今日速览 2×2 / 本周打卡条 / 🤖 今日洞察 / 大类分布 / 近 14 天热力。
 * parent 需已带 .home-dashboard.home-v2 根类（样式前缀约定）。
 */
export function renderSidePanel(
	parent: HTMLElement,
	pages: InboxPage[],
	moment: MomentLike,
): void {
	parent.empty();
	const SC = statsCore();

	// 按天计数一份算好（速览/打卡/热力共用：日期键、连续天数都从它来；口径在 stats-core）
	const counts = SC.dayCounts(pages, (p) => p.ctime, (ms) => moment(ms).format("YYYY-MM-DD"));
	const today = moment();
	const todayStr = today.format("YYYY-MM-DD");
	const streak = SC.streak(Object.keys(counts), todayStr);
	const pending = pages.filter((p) => p.status === "pending").length;

	/* —— 今日速览：2×2 数字格 —— */
	const quickWrap = parent.createDiv({ cls: "sp-quick-wrap" });
	quickWrap.createDiv({ cls: "sp-label", text: "今日速览" });
	const quick = quickWrap.createDiv({ cls: "sp-quick" });
	const q = (n: string, label: string): void => {
		const el = quick.createDiv({ cls: "sp-q" });
		el.createEl("b", { text: n, cls: "sp-q-num" });
		el.createEl("span", { text: label, cls: "sp-q-label" });
	};
	q(String(counts[todayStr] || 0), "今日已记");
	q(String(pending), "待办未完");
	q(String(pages.length), "累计记录");
	q(String(streak), "连续天数");

	/* —— 本周打卡条：一~日 7 格圆点 —— */
	const week = parent.createDiv({ cls: "sp-week" });
	week.createDiv({ cls: "sp-label", text: "本周打卡" });
	const dots = week.createDiv({ cls: "sp-dots" });
	const weekStartDate = moment(SC.weekStart(Date.now()));
	let done = 0;
	for (let i = 0; i < 7; i++) {
		const d = weekStartDate.clone().add(i, "day");
		const k = d.format("YYYY-MM-DD");
		const rec = (counts[k] || 0) > 0;
		if (rec) done++;
		const zh = "一二三四五六日"[d.isoWeekday() - 1];
		const day = dots.createDiv({
			cls: "sp-day" + (k === todayStr ? " is-today" : ""),
			attr: { "data-tip": `周${zh} ${k} · ${counts[k] || 0} 条` },
		});
		day.createDiv({ cls: "sp-day-zh", text: zh });
		day.createDiv({ cls: "sp-dot" + (rec ? " is-rec" : "") });
	}
	week.createDiv({
		cls: "sp-week-cap",
		text: `本周已记 ${done} 天 · 再记 ${Math.max(0, 7 - done)} 天全勤`,
	});

	/* —— 🤖 今日洞察：本地规则生成的一句话观察（不调外部接口） —— */
	const ins = parent.createDiv({ cls: "sp-insight" });
	ins.createDiv({ cls: "sp-label" }, (lab) => {
		putIcon(lab, "sparkles", ICON_TITLE);
		lab.createSpan({ text: "今日洞察" });
	});
	ins.createDiv({ cls: "sp-bubble", text: SC.insightText(pages, streak, Date.now()) });

	/* —— 大类分布：紧凑条形 —— */
	const cats = parent.createDiv({ cls: "sp-cats" });
	cats.createDiv({ cls: "sp-label" }, (lab) => {
		putIcon(lab, "folder-open", ICON_TITLE);
		lab.createSpan({ text: "大类分布" });
	});
	const catRows = Object.entries(SC.countBy(pages, (p) => p.category)).sort(
		(a, b) => b[1] - a[1],
	);
	if (!catRows.length) {
		cats.createDiv({ cls: "mini-muted", text: "AI 归类后这里会显示各大类条数" });
	} else {
		const total = catRows.reduce((s, r) => s + r[1], 0);
		const body = cats.createDiv({ cls: "sp-cats-body" });
		for (const [cat, n] of catRows) {
			const line = body.createDiv({ cls: "bar-line" });
			line.createEl("span", { text: cat, cls: "bar-label" });
			const bar = line.createDiv({ cls: "bar-track" });
			bar.createDiv({ cls: "bar-fill" }).style.width = Math.round((n * 100) / total) + "%";
			line.createEl("span", { text: String(n), cls: "bar-num" });
		}
	}

	/* —— 记录热力：近 14 天方格（沿用 hm-cell 色阶） —— */
	const heat = parent.createDiv({ cls: "sp-heat" });
	const heatHead = heat.createDiv({ cls: "sp-heat-head" });
	const heatLabel = heatHead.createSpan({ cls: "sp-label" });
	putIcon(heatLabel, "flame", ICON_TITLE);
	heatLabel.createSpan({ text: "记录热力" });
	heatHead.createSpan({ cls: "sp-heat-sub", text: "近 14 天" });
	const cells = heat.createDiv({ cls: "sp-heat-cells" });
	for (let i = 13; i >= 0; i--) {
		const d = today.clone().subtract(i, "day");
		const k = d.format("YYYY-MM-DD");
		const n = counts[k] || 0;
		const lvl = SC.heatmapLevel(n);
		cells.createDiv({
			cls: `hm-cell lv${lvl}`,
			attr: { "data-tip": `${k} · ${n} 条` },
		});
	}
}

/**
 * 🌱 最近新增 feed 卡（行 动 分区右列）。按创建时间倒序前 8 条，
 * 点击经 opts.showDetail 呼出详情弹窗（宿主接 detail-modal）。
 */
export function renderRecentCard(
	parent: HTMLElement,
	pages: InboxPage[],
	moment: MomentLike,
	opts: { showDetail?: (page: InboxPage, opts?: { focusInput?: boolean }) => void } = {},
): void {
	parent.empty();
	const card = parent.createDiv({ cls: "dash-card card-bamboo recent-card" });
	const head = card.createDiv({ cls: "recent-head" });
	const h3 = head.createEl("h3");
	putIcon(h3, "sprout", ICON_TITLE);
	h3.createSpan({ text: "最近新增" });
	head.createSpan({ cls: "recent-count", text: `${pages.length} 条` });
	const body = card.createDiv({ cls: "recent-body" });
	enableDragScroll(body); // 滚动条已隐藏，补鼠标按住拖拽滚动
	const recent = [...pages].sort((a, b) => b.ctime - a.ctime).slice(0, 8);
	if (!recent.length) {
		body.createDiv({ cls: "mini-muted", text: "还没有记录，随手记一条开始 🎋" });
		return;
	}
	for (const p of recent) {
		const row = body.createDiv({ cls: "recent-row" });
		const a = row.createEl("a", {
			cls: "internal-link recent-link",
			text: p.summary || p.name,
			attr: { href: p.path },
		});
		a.addEventListener("click", (ev) => {
			ev.preventDefault();
			opts.showDetail?.(p);
		});
		row.createEl("span", {
			text: `${moment(p.ctime).format("MM-DD")}${p.category ? " · " + p.category : ""}`,
			cls: "recent-meta",
		});
	}
	// 超过 5 条时列表区限高，其余靠滚动/拖拽查看（与 todo 卡同款折算，4px 补行高取整误差）
	const MAX_VISIBLE = 5;
	if (recent.length > MAX_VISIBLE) {
		const first = body.firstElementChild as HTMLElement | null;
		const h = first?.offsetHeight ?? 0;
		if (h > 0) body.setCssProps({ maxHeight: `${h * MAX_VISIBLE + 4}px` });
	} else {
		body.setCssProps({ maxHeight: "" });
	}
}
