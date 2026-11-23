/* ============================================================
   daylog-view —— ⏱ 时间轴卡片渲染（票 05）
   渲染逻辑自 Home.md 的 renderDaylog/dlStripDialog 迁入：
   色带滑动选格 → 弹窗填写 → daylog-core 落盘 → 重绘。
   与旧版的三点差别：
   - 依赖注入（app/moment/notice），拖选状态收在渲染闭包里，
     document 级 mouseup 由 destroy() 摘除（不碰 window 全局；
     Modal 内的 setTimeout 为 DOM API，非共享状态）；
   - 填写弹窗用 Obsidian Modal（旧 lf-dialog 外观来自主题，
     插件不能依赖主题，弹窗自带最小内联样式）；
   - tooltip 从自绘 data-tip 简化为原生 title（同 stats-view）。
   ============================================================ */
import { Modal, type App } from "obsidian";
import { daylogCore, type DaylogApp, type DaylogRow } from "./daylog-core";
import type { Moment } from "moment";
import { resolveConventions, type Conventions } from "./conventions";
import { putIcon, ICON_TITLE, ICON_BTN } from "./icon";

/** moment 的最小切片（同 stats-view）。 */
export type MomentLike = (input?: unknown) => Moment;

/** 未分类时段的灰（色带与弹窗单选同款，单点来源）。 */
const UNCATEGORIZED_COLOR = "#9aa39a";

/** 格序 → 展示标签：全日 0 点起顺铺，无跨日段，直接用槽位时刻。 */
function slotLabel(SLOTS: string[], idx: number): string {
	return SLOTS[idx];
}

export interface DaylogViewDeps {
	/** Obsidian App：数据切片走 DaylogApp，Modal 构造用完整引用。 */
	app: DaylogApp & App;
	moment: MomentLike;
	notice: (msg: string) => void;
	conventions: Conventions;
	/** 拖选落盘后的回调（Home 视图借此刷新统计等）。 */
	onSaved?: () => void;
}

export interface DaylogCard {
	/** 摘除 document 级监听（视图关闭时调用）。 */
	destroy(): void;
}

/** 「今天」的 daylog 日（自然日 0 点日界）已收编进 daylog-core 的 dayDate——
    视图不再持有日界运算，ADR 0006 的「两处须同步改」注释同步作废。 */

/** hex 颜色 → rgba（类型单选的淡色底；UI 着色，不属数据层）。 */
function hexA(h: string, a: number): string {
	const v = parseInt(h.slice(1), 16);
	return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}

/**
 * 纯 DOM 组装：parent 需已带 .home-dashboard.home-v2 根类（样式前缀约定）。
 * 卡片内自管状态（当前展示日期、行缓存），返回 destroy 供视图卸载时清理。
 */
export function renderDaylogCard(parent: HTMLElement, deps: DaylogViewDeps): DaylogCard {
	const { TYPES, TYPE_BY, SLOTS } = daylogCore;
	const inboxDir = resolveConventions(deps.conventions).inboxDir;
	let viewDate = daylogCore.dayDate(deps.moment().valueOf());
	let rowsCache: Record<string, DaylogRow> | null = null;
	let rowsCacheDate = "";

	/* —— 卡片骨架：标题 + 迷你图例 + 翻天导航 —— */
	const card = parent.createDiv({ cls: "dash-card card-bamboo dl-card" });
	const h3 = card.createEl("h3");
	putIcon(h3, "clock", ICON_TITLE);
	h3.createSpan({ text: "时间轴" });
	for (const t of TYPES) {
		const lg = h3.createEl("span", { cls: "dl-h3-lg", attr: { "data-tip": t.tip } });
		lg.createEl("i").style.background = t.color;
		lg.createEl("span", { text: t.zh });
	}
	const nav = card.createDiv({ cls: "dl-nav" });
	const mkNav = (text: string, tip: string, fn: () => void, solid = false): void => {
		nav.createEl("button", { cls: solid ? "card-act is-solid" : "card-act", text, attr: { "data-tip": tip } }).addEventListener("click", fn);
	};
	mkNav("‹", "上一天", () => {
		viewDate = deps.moment(viewDate).subtract(1, "day").format("YYYY-MM-DD");
		void renderDaylog();
	});
	mkNav("今天", "回到今天", () => {
		viewDate = daylogCore.dayDate(deps.moment().valueOf());
		void renderDaylog();
	}, true);
	mkNav("›", "下一天", () => {
		viewDate = deps.moment(viewDate).add(1, "day").format("YYYY-MM-DD");
		void renderDaylog();
	});

	const strip = card.createDiv({ cls: "dl-strip" });
	{
		// 色带下方的小时标注（HH）：每格对应两个半小时格；槽序自 00:00 顺铺，
		// 标注跟随槽序：00…23
		const hours = card.createDiv({ cls: "dl-hours" });
		for (let k = 0; k < 24; k++) hours.createEl("span", { text: String(k).padStart(2, "0") });
	}
	const hint = card.createDiv({ cls: "dl-card-hint", text: "左键滑动选格，松开即填内容" });

	/* —— 色带滑动选择：按下定锚点、滑过扩选区、松开弹窗填写 —— */
	let drag: { anchor: number; to: number } | null = null;
	const paint = (a: number, b: number): void => {
		Array.from(strip.children).forEach((c, i) => c.classList.toggle("dl-strip-sel", i >= a && i <= b));
	};
	const onUp = (): void => {
		const d = drag;
		if (!d) return;
		drag = null;
		paint(-1, -1);
		fillDialog(Math.min(d.anchor, d.to), Math.max(d.anchor, d.to));
	};
	document.addEventListener("mouseup", onUp);

	async function saveDay(date: string, rows: Record<string, DaylogRow>): Promise<void> {
		await daylogCore.save(deps.app, date, rows, inboxDir);
		rowsCache = rows; // 色带缓存同步更新（弹窗保存后立即生效）
		rowsCacheDate = date;
	}

	async function renderDaylog(): Promise<void> {
		// 同一日期优先用上次缓存同步渲染（色带不再先空后填地闪），缓存不命中才读盘
		let rows: Record<string, DaylogRow>;
		if (rowsCache && rowsCacheDate === viewDate) {
			rows = rowsCache;
		} else {
			rows = await daylogCore.read(deps.app, viewDate, inboxDir);
			rowsCache = rows;
			rowsCacheDate = viewDate;
		}
		strip.empty();
		let filled = 0;
		SLOTS.forEach((slot, idx) => {
			const cell = strip.createDiv();
			const r = rows[slot];
			const lbl = slotLabel(SLOTS, idx);
			if (r && (r.desc || r.type)) {
				filled++;
				const t = TYPE_BY[r.type];
				// 未分类（type ''）也上色：与弹窗单选同款灰，否则格子落入几乎不可见的兜底色
				cell.style.setProperty("--c", t ? t.color : UNCATEGORIZED_COLOR);
				cell.setAttribute("data-tip", `${lbl} ${r.desc || ""}${t ? " · " + t.zh : ""}`);
			} else {
				cell.setAttribute("data-tip", `${lbl}（未记录）`);
			}
			cell.addEventListener("mousedown", (e: MouseEvent) => {
				if (e.button !== 0) return;
				e.preventDefault();
				drag = { anchor: idx, to: idx };
				paint(idx, idx);
			});
			cell.addEventListener("mouseenter", () => {
				if (!drag) return;
				drag.to = idx;
				paint(Math.min(drag.anchor, idx), Math.max(drag.anchor, idx));
			});
		});
		const wk = "周" + "日一二三四五六"[deps.moment(viewDate).day()];
		hint.setText(`${viewDate} ${wk} · 已记 ${filled} 格 · 左键滑动选格续记`);
	}

	/** 色带选区松开后的填写弹窗（Obsidian Modal，插件自带最小样式）。 */
	function fillDialog(a: number, b: number): void {
		const rows0 = rowsCache || {};
		// 选区已有内容时回显到输入框与类型单选
		let first: DaylogRow | null = null;
		for (let k = a; k <= b; k++) {
			const r = rows0[SLOTS[k]];
			if (r && (r.desc || r.type)) {
				first = r;
				break;
			}
		}
		const dialog = new FillModal(deps.app, deps, viewDate, a, b, first, async (desc, type) => {
			const rows = await daylogCore.read(deps.app, viewDate, inboxDir);
			for (let k = a; k <= b; k++) rows[SLOTS[k]] = { desc, type };
			await saveDay(viewDate, rows);
			await renderDaylog(); // 落盘后同步缓存并重绘（saveDay 已把写盘内容换入缓存）
			deps.notice("✅ 时间轴已更新");
			deps.onSaved?.();
		});
		dialog.open();
	}

	void renderDaylog();
	return {
		destroy(): void {
			document.removeEventListener("mouseup", onUp);
		},
	};
}

/** 填写弹窗：输入框 + 类型单选联体分段 + 确定/取消。 */
class FillModal extends Modal {
	constructor(
		app: App,
		private deps: DaylogViewDeps,
		private date: string,
		private a: number,
		private b: number,
		private existing: DaylogRow | null,
		private submit: (desc: string, type: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { TYPES, SLOTS } = daylogCore;
		// 跨日界（格 31→32）时两端都要「次日」前缀，否则 23:30–00:30 读起来像同一天
		const start = slotLabel(SLOTS, this.a).split("-")[0];
		const end = slotLabel(SLOTS, this.b).split("-")[1];
		this.titleEl.setText("");
		putIcon(this.titleEl, "clock", ICON_BTN);
		this.titleEl.createSpan({ text: ` ${this.date} ${start} – ${end}` });
		const input = this.contentEl.createEl("input", {
			attr: { type: "text", placeholder: "这段时间做了什么…" },
		});
		input.addClass("hd-form-input");
		input.addClass("hd-daylog-input");
		input.value = this.existing ? this.existing.desc || "" : "";
		// 不用真实 radio：选择状态自己维护，保证严格互斥（点击谁谁选中，其余必为未选）
		let picked = this.existing ? this.existing.type || "" : "";
		const typeRow = this.contentEl.createDiv({ cls: "hd-type-row" });
		const opts: { key: string; lab: HTMLElement }[] = [];
		const mkRadio = (key: string, zh: string, color: string, tip: string): void => {
			const lab = typeRow.createDiv({ attr: { "data-tip": `${zh} · ${tip}` } });
			lab.addClass("hd-type-opt");
			lab.createEl("span", { text: zh });
			// 类型底色是运行时算出的动态值，走 setCssStyles（审核认可的动态样式出口）
			lab.setCssStyles({ backgroundColor: hexA(color, 0.3) });
			opts.push({ key, lab });
			lab.addEventListener("click", () => {
				picked = key;
				updateRadios();
			});
		};
		const updateRadios = (): void =>
			opts.forEach((o) => {
				o.lab.toggleClass("is-picked", o.key === picked);
			});
		mkRadio("", "未分类", UNCATEGORIZED_COLOR, "尚未归类的时间");
		for (const t of TYPES) mkRadio(t.key, t.zh, t.color, t.tip);
		updateRadios();

		const btns = this.contentEl.createDiv({ cls: "hd-form-actions" });
		const ok = btns.createEl("button", { text: "确定" });
		const cancel = btns.createEl("button", { text: "取消" });
		cancel.addEventListener("click", () => this.close());
		const doSubmit = (): void => {
			this.close();
			void this.submit(input.value.trim(), picked);
		};
		ok.addEventListener("click", doSubmit);
		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") doSubmit();
			if (e.key === "Escape") this.close();
		});
		window.setTimeout(() => input.focus(), 30);
	}
}
