/* ============================================================
   todo-expanded —— 待办放大视图（IKY82E，方案 B 双栏看板，原型定稿）：
   - 覆盖 Home 全部块区域的浮层（挂视图根容器，Invariant 1 同 backdrop）；
   - 统计条 / 进行中 / 未开始三栏（马上|近期|以后做，拖拽换栏改 urgency）/
     已完成（含完成日期）/ 已放弃（可复原）；
   - 行内次操作文字按钮：跟进（行内输入回车保存）、开始/暂停/完成/放弃/复原、
     分面循环修正（energy: 深↔浅、urgency: 马上→近期→以后）；
   - 数据口径全部来自 todo-core（transitStatus/todoBoard/分面循环），
     本文件只做渲染与落盘接线。
   ============================================================ */
import { localStamp } from "./classify-core";
import { putIcon, ICON_TITLE } from "./icon";
import {
	transitStatus,
	todoBoard,
	nextEnergy,
	nextUrgency,
	followupCounts,
	type TodoItem,
} from "./todo-core";
import { createInboxNote, type NoteCreateAppLike } from "./note-create";

export interface ExpandedPageLike extends TodoItem {
	path: string;
	name: string;
	ctime: number;
	summary: string;
	category: string;
	status: string;
	completed: number;
	energy: string;
	urgency: string;
	related: unknown;
}

export interface ExpandedDeps {
	app: NoteCreateAppLike & {
		vault: { getAbstractFileByPath(path: string): unknown };
		fileManager: {
			processFrontMatter(
				file: unknown,
				fn: (fm: Record<string, unknown>) => void,
			): Promise<void>;
		};
		metadataCache: {
			getCache(path: string): { frontmatter?: Record<string, unknown> | null } | null;
		};
	};
	/** 视图根容器（.home-dashboard.home-v2）：浮层挂载点（Invariant 1）。 */
	root: HTMLElement;
	/** 最新页面快照（每次操作后重取，重绘面板）。 */
	getPages: () => ExpandedPageLike[];
	inboxDir: string;
	moment: (t: number) => { format(fmt: string): string };
	notice: (msg: string) => void;
	/** 数据变化后由宿主刷新整页。 */
	refresh: () => void;
	/** 点击行标题 → 详情弹窗。 */
	showDetail: (page: ExpandedPageLike) => void;
}

/** 与 todo-view/detail-modal 同款：轮询 metadataCache 直到条件满足。 */
const waitFor = async (pred: () => boolean, timeout = 5000): Promise<boolean> => {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (pred()) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
};

const STATUS_ZH: Record<string, string> = {
	pending: "未开始",
	doing: "进行中",
	done: "已完成",
	dropped: "已放弃",
};
const ENERGY_ZH: Record<string, string> = { deep: "深", shallow: "浅", "": "未分" };
const URGENCY_ZH: Record<string, string> = {
	now: "马上",
	soon: "近期",
	someday: "以后",
	"": "未分",
};

export function openExpandedTodos(deps: ExpandedDeps): () => void {
	const overlay = deps.root.createDiv({ cls: "todo-exp-overlay" });
	const board = overlay.createDiv({ cls: "todo-exp card-bamboo" });

	const close = (): void => {
		document.removeEventListener("keydown", onKey, true);
		overlay.remove();
	};
	const onKey = (e: KeyboardEvent): void => {
		if (e.key === "Escape") {
			e.stopPropagation();
			close();
		}
	};
	document.addEventListener("keydown", onKey, true);
	overlay.addEventListener("click", (e) => {
		if (e.target === overlay) close();
	});
	board.addEventListener("click", (e) => e.stopPropagation());

	/* —— 头：标题 + 当前日期 + 收起 —— */
	const head = board.createDiv({ cls: "todo-exp-head" });
	const h3 = head.createEl("h3");
	putIcon(h3, "square-check", ICON_TITLE);
	h3.createSpan({ text: "待办（放大视图）" });
	const now = new Date();
	const wk = "日一二三四五六"[now.getDay()];
	head.createSpan({
		cls: "todo-exp-date",
		text: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} 周${wk}`,
	});
	head.createEl("button", { cls: "detail-close card-act", text: "✕" }).addEventListener("click", close);

	const body = board.createDiv({ cls: "todo-exp-body" });

	async function write(fmPath: string, fn: (fm: Record<string, unknown>) => void, waitPred: (fm: Record<string, unknown>) => boolean, msg: string): Promise<void> {
		const f = deps.app.vault.getAbstractFileByPath(fmPath);
		if (!f) return;
		await deps.app.fileManager.processFrontMatter(f, fn);
		if (msg) deps.notice(msg);
		await waitFor(() => {
			const fm = deps.app.metadataCache.getCache(fmPath)?.frontmatter;
			return !!fm && waitPred(fm);
		});
		deps.refresh();
		render();
	}

	const setStatus = (p: ExpandedPageLike, action: string, zh: string): void => {
		const target = transitStatus(p.status, action);
		if (!target) return;
		void write(
			p.path,
			(fm) => {
				fm.status = target;
				if (target === "done") fm.completed = localStamp();
				if (p.status === "done" && target !== "done") fm.completed = "";
			},
			(fm) => fm.status === target,
			zh,
		);
	};

	const setFacet = (p: ExpandedPageLike, key: "energy" | "urgency", value: string): void => {
		void write(
			p.path,
			(fm) => {
				fm[key] = value;
			},
			(fm) => fm[key] === value,
			"",
		);
	};

	const dropUrgency = (p: ExpandedPageLike, urgency: string): void => {
		if (p.urgency === urgency) return;
		void write(
			p.path,
			(fm) => {
				fm.urgency = urgency;
			},
			(fm) => fm.urgency === urgency,
			"",
		);
	};

	/* —— 行：状态点 + 分面文字按钮 + 标题 + 跟进计数 + 次操作按钮组 —— */
	function row(parent: HTMLElement, p: ExpandedPageLike, ops: boolean, drag: boolean): void {
		const wrap = parent.createDiv({ cls: "todo-exp-rowwrap" });
		if (drag) {
			wrap.setAttr("draggable", "true");
			wrap.setAttr("data-drag", p.path);
		}
		const rowEl = wrap.createDiv({ cls: `todo-exp-row is-${p.status}` });
		const link = rowEl.createEl("a", { cls: "internal-link todo-exp-title", text: p.summary || p.name });
		link.addEventListener("click", (ev) => {
			ev.preventDefault();
			deps.showDetail(p);
		});
		const fu = followupCounts(deps.getPages())[p.name] ?? 0;
		if (fu) rowEl.createSpan({ cls: "todo-exp-fu", text: `${fu}条跟进` });
		if (p.status === "done" && p.completed) {
			rowEl.createSpan({ cls: "todo-exp-doneat", text: deps.moment(p.completed).format("YYYY-MM-DD") });
		}
		const act = rowEl.createDiv({ cls: "todo-exp-ops" });
		if (!ops) return;
		// 分面修正：次操作文字按钮，当前值高亮，点击循环切换
		const eBtn = act.createEl("button", { cls: `card-act todo-exp-facet${p.energy ? " is-set" : ""}`, text: ENERGY_ZH[p.energy] ?? p.energy });
		eBtn.addEventListener("click", () => setFacet(p, "energy", nextEnergy(p.energy)));
		const uBtn = act.createEl("button", { cls: `card-act todo-exp-facet${p.urgency ? " is-set" : ""}`, text: URGENCY_ZH[p.urgency] ?? p.urgency });
		uBtn.addEventListener("click", () => setFacet(p, "urgency", nextUrgency(p.urgency)));
		// 跟进：行内输入，回车落一条 related 笔记（不重新归类，领域继承）
		const fuBtn = act.createEl("button", { cls: "card-act", text: "跟进" });
		fuBtn.addEventListener("click", () => {
			if (wrap.querySelector(".todo-exp-fu-in")) return;
			const frow = wrap.createDiv({ cls: "todo-exp-fu-row" });
			const inp = frow.createEl("input", { cls: "todo-input todo-exp-fu-in", attr: { type: "text", placeholder: "记一条跟进，回车保存…" } });
			inp.focus();
			inp.addEventListener("keydown", (e) => {
				if (e.key !== "Enter") return;
				const v = inp.value.trim();
				if (!v) return;
				void (async () => {
					const created = await createInboxNote(
						deps.app,
						deps.inboxDir,
						deps.moment(Date.now()).format("YYYY-MM-DD-HHmmss"),
						{
							category: p.category || "",
							subcategory: "",
							subsubcategory: "",
							summary: v.replace(/\s+/g, " ").slice(0, 30),
							tags: [],
							status: "",
							related: `"[[${p.name}]]"`,
						},
						v,
					);
					deps.notice("✅ 跟进已记录");
					await waitFor(() => {
						const fm = deps.app.metadataCache.getCache(created)?.frontmatter;
						return !!fm && typeof fm.related === "string" && fm.related.includes(p.name);
					});
					deps.refresh();
					render();
				})();
			});
		});
		// 状态流转：按当前状态给合法动作（口径在 todo-core 状态机）
		const mk = (label: string, action: string, zh: string, cls = ""): void => {
			const b = act.createEl("button", { cls: `card-act${cls ? " " + cls : ""}`, text: label });
			b.addEventListener("click", () => setStatus(p, action, zh));
		};
		if (p.status === "pending") mk("开始", "doing", "▶ 已开始", "act-strong");
		if (p.status === "doing") mk("暂停", "pending", "⏸ 已暂停");
		mk("完成", "done", "🎉 已完成");
		if (p.status !== "dropped") mk("放弃", "dropped", "🙇 已放弃");
		else mk("复原", "pending", "🔁 已复原");
	}

	function section(title: string, hint: string, collapsed = false): { sec: HTMLElement; rows: HTMLElement } {
		const sec = body.createDiv({ cls: `todo-exp-sec${collapsed ? " is-collapsed" : ""}` });
		const sh = sec.createDiv({ cls: "todo-exp-sec-head" });
		if (collapsed) sh.createSpan({ cls: "todo-exp-arrow", text: "▸" });
		sh.createSpan({ text: title });
		sh.createSpan({ cls: "todo-exp-n", text: hint });
		if (collapsed) {
			sh.addEventListener("click", () => {
				sec.classList.toggle("is-collapsed");
			});
		}
		const rows = sec.createDiv({ cls: "todo-exp-rows" });
		return { sec, rows };
	}

	function render(): void {
		const pages = deps.getPages();
		const b = todoBoard(pages, Date.now());
		body.empty();

		/* —— 统计条 —— */
		const stats = body.createDiv({ cls: "todo-exp-stats" });
		const st = b.stats;
		const items: [string, string | number][] = [
			["进行中", st.doing],
			["未开始", st.pending],
			["本周完成", st.doneWeek],
			["本周放弃", st.droppedWeek],
			["深度占比", `${st.deepPct}%`],
		];
		for (const [k, v] of items) {
			const cell = stats.createDiv({ cls: "todo-exp-stat" });
			cell.createEl("b", { text: String(v) });
			cell.createSpan({ text: k });
		}

		/* —— 进行中 —— */
		const doingSec = section("进行中", `${b.doing.length}`);
		for (const p of b.doing) row(doingSec.rows, p, true, false);
		if (!b.doing.length) doingSec.rows.createDiv({ cls: "todo-exp-empty", text: "还没有进行中的事，从下面开始一件" });

		/* —— 未开始三栏（拖拽换栏改 urgency） —— */
		const pendSec = body.createDiv({ cls: "todo-exp-sec" });
		pendSec.createDiv({ cls: "todo-exp-sec-head" }, (sh) => {
			sh.createSpan({ text: "未开始" });
			sh.createSpan({ cls: "todo-exp-n", text: `${b.now.length + b.soon.length + b.someday.length}` });
		});
		const cols = pendSec.createDiv({ cls: "todo-exp-cols" });
		let dragPath: string | null = null;
		const zones: [string, string, typeof b.now][] = [
			["now", "马上（有明确期限）", b.now],
			["soon", "近期（无硬期限）", b.soon],
			["someday", "以后做", b.someday],
		];
		for (const [u, label, list] of zones) {
			const zone = cols.createDiv({ cls: "todo-exp-zone" });
			zone.createDiv({ cls: "todo-exp-colhead", text: `${label} · 拖入` });
			for (const p of list) row(zone, p, true, true);
			if (!list.length) zone.createDiv({ cls: "todo-exp-empty", text: "拖待办到这里" });
			zone.addEventListener("dragover", (e) => {
				e.preventDefault();
				zone.classList.add("is-over");
			});
			zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
			zone.addEventListener("drop", (e) => {
				e.preventDefault();
				zone.classList.remove("is-over");
				const t = pages.find((x) => x.path === dragPath);
				dragPath = null;
				if (t && t.urgency !== u) dropUrgency(t, u);
			});
		}
		body.querySelectorAll("[data-drag]").forEach((el) => {
			el.addEventListener("dragstart", (e) => {
				dragPath = (el as HTMLElement).getAttr("data-drag");
				(el as HTMLElement).classList.add("is-dragging");
			});
			el.addEventListener("dragend", (e) => {
				(el as HTMLElement).classList.remove("is-dragging");
				body.querySelectorAll(".is-over").forEach((z) => z.classList.remove("is-over"));
			});
		});

		/* —— 已完成（默认折叠）/ 已放弃（默认折叠，可复原） —— */
		const doneSec = section("已完成", `${b.done.length}`, true);
		for (const p of b.done) row(doneSec.rows, p, false, false);
		const dropSec = section("已放弃", `${b.dropped.length}`, true);
		for (const p of b.dropped) row(dropSec.rows, p, true, false);
	}

	render();
	return close;
}
