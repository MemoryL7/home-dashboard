/* ============================================================
   detail-modal —— 待办/最近新增的详情弹窗（玻璃模糊浮层）：
   - 点击待办行或最近新增行呼出，展示笔记正文（Markdown 渲染）；
   - 若是待办（status pending）：列出跟进条目，可删（整条进回收站）、
     可记新跟进、可标记完成；
   - 浮层挂在视图根容器内（Invariant 1：与卡片同 backdrop 取样树，
     卡片能 blur 竹子，弹窗同款玻璃才有得 blur），不挂 body；
   - 全局只存一个活动弹窗：再次呼出先关旧的，onClose 由宿主
     closeDetailModal() 兜底（Esc 监听挂 document，视图卸载要摘）。
   ============================================================ */
import { MarkdownRenderer, type Component } from "obsidian";
import { putIcon, ICON_TITLE, ICON_BTN } from "./icon";
import { localStamp } from "./classify-core";
import { followupsFor, relatedTargets, stripFrontmatter, type FollowupItem } from "./todo-core";
import { createInboxNote, type NoteCreateAppLike } from "./note-create";

export interface DetailPageLike {
	path: string;
	name: string;
	ctime: number;
	summary: string;
	category: string;
	status: string;
	related: unknown;
}

export interface DetailDeps {
	app: NoteCreateAppLike & {
		vault: {
			read(file: unknown): Promise<string>;
			trash(file: unknown, system: boolean): Promise<void>;
			getAbstractFileByPath(path: string): unknown;
		};
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
	/** 视图根容器（.home-dashboard.home-v2）：浮层的挂载点。 */
	root: HTMLElement;
	/** 供 MarkdownRenderer 用的组件（宿主视图），滚进跟随卸载。 */
	component: Component;
	/** 最新页面快照（记跟进/删跟进后重新取，重绘跟进区）。 */
	getPages: () => DetailPageLike[];
	/** 数据变化后由宿主刷新整页（卡片/统计）。 */
	refresh: () => void;
	inboxDir: string;
	moment: (t: number) => { format(fmt: string): string };
	notice: (msg: string) => void;
	renderMarkdown: (el: HTMLElement, md: string, path: string) => Promise<void>;
}

let activeClose: (() => void) | null = null;

/** 与 todo-view 同款：轮询 metadataCache 直到条件满足（新笔记/改动入索引）。 */
const waitFor = async (pred: () => boolean, timeout = 5000): Promise<boolean> => {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (pred()) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
};

/** 宿主 onclose 兜底：摘掉 Esc 监听、移除浮层（挂着的弹窗随视图一起消失）。 */
export function closeDetailModal(): void {
	activeClose?.();
}

export function openDetailModal(
	deps: DetailDeps,
	page: DetailPageLike,
	opts: { focusInput?: boolean } = {},
): void {
	activeClose?.(); // 单例：再次呼出先关旧的

	const overlay = deps.root.createDiv({ cls: "detail-overlay" });
	const modal = overlay.createDiv({ cls: "detail-modal card-bamboo" });

	const close = (): void => {
		document.removeEventListener("keydown", onKey, true);
		overlay.remove();
		if (activeClose === close) activeClose = null;
	};
	const onKey = (e: KeyboardEvent): void => {
		if (e.key === "Escape") {
			e.stopPropagation();
			close();
		}
	};
	document.addEventListener("keydown", onKey, true);
	activeClose = close;
	// 点背景空白处关弹窗；仅当按下与松开都在空白处才算「点空白」，
	// 在卡片内选字拖到空白处松手不误关。卡片内点击不冒泡
	let downOnOverlay = false;
	overlay.addEventListener("pointerdown", (e) => {
		downOnOverlay = e.target === overlay;
	});
	overlay.addEventListener("click", (e) => {
		if (downOnOverlay && e.target === overlay) close();
	});
	modal.addEventListener("click", (e) => e.stopPropagation());

	/* —— 头：标题（下方属性行） + 关闭 —— */
	const head = modal.createDiv({ cls: "detail-head" });
	const headMain = head.createDiv({ cls: "detail-head-main" });
	const h3 = headMain.createEl("h3");
	putIcon(h3, "file-text", ICON_TITLE);
	h3.createSpan({ text: page.summary || page.name });
	// 属性行贴在标题正下方（分隔线之上），不落到横杠下面
	renderProps(deps, headMain, page);
	head.createEl("button", { cls: "detail-close card-act", text: "✕" }).addEventListener(
		"click",
		close,
	);

	/* —— 正文：笔记内容（去 frontmatter，Markdown 渲染） —— */
	const body = modal.createDiv({ cls: "detail-body" });
	void (async () => {
		const f = deps.app.vault.getAbstractFileByPath(page.path);
		if (!f) {
			body.setText("（笔记不存在，可能已被删除）");
			return;
		}
		const raw = await deps.app.vault.read(f);
		await deps.renderMarkdown(body, stripFrontmatter(raw), page.path);
	})();

	/* —— 待办区：跟进列表 + 记跟进 + 完成（仅 pending 待办显示） —— */
	if (page.status === "pending") {
		renderTodoSection(deps, modal, page, close, opts);
	}
}

/** 属性行：从 metadataCache 取 frontmatter，挑用户关心的字段排成 chips。
 *  状态 pending→进行中 / done→已完成；空字段跳过。 */
function renderProps(deps: DetailDeps, modal: HTMLElement, page: DetailPageLike): void {
	const fm = deps.app.metadataCache.getCache(page.path)?.frontmatter;
	if (!fm) return;
	const STATUS_ZH: Record<string, string> = { pending: "进行中", done: "已完成" };
	const chips: string[] = [];
	const cat = [fm.category, fm.subcategory, fm.subsubcategory]
		.filter((x) => typeof x === "string" && x.trim())
		.join(" / ");
	if (cat) chips.push(cat);
	if (typeof fm.status === "string" && fm.status)
		chips.push(STATUS_ZH[fm.status] ?? fm.status);
	if (Array.isArray(fm.tags) && fm.tags.length) chips.push(fm.tags.map(String).join(" "));
	chips.push(`创建 ${deps.moment(page.ctime).format("YYYY-MM-DD HH:mm")}`);
	if (typeof fm.completed === "string" && fm.completed) chips.push(`完成 ${fm.completed}`);
	const row = modal.createDiv({ cls: "detail-props" });
	for (const c of chips) row.createSpan({ text: c, cls: "detail-prop" });
}

function renderTodoSection(
	deps: DetailDeps,
	modal: HTMLElement,
	page: DetailPageLike,
	close: () => void,
	opts: { focusInput?: boolean } = {},
): void {
	const sec = modal.createDiv({ cls: "detail-todo" });
	const listEl = sec.createDiv({ cls: "detail-fu-list" });
	const newRow = sec.createDiv({ cls: "todo-new" });
	const inp = newRow.createEl("input", {
		cls: "todo-input",
		attr: { type: "text", placeholder: "记一条跟进，回车保存…" },
	});
	const foot = sec.createDiv({ cls: "detail-foot" });

	function renderList(pages: DetailPageLike[]): void {
		listEl.empty();
		const fus = followupsFor(pages as (DetailPageLike & FollowupItem)[], page.name);
		if (!fus.length) {
			listEl.createDiv({ cls: "detail-fu-empty", text: "还没有跟进记录" });
			return;
		}
		for (const f of fus) {
			const row = listEl.createDiv({ cls: "detail-fu-row" });
			row.createEl("span", { text: f.summary || f.name, cls: "detail-fu-text" });
			row.createEl("span", { text: deps.moment(f.ctime).format("MM-DD"), cls: "detail-fu-time" });
			row
				// 不加 data-tip：全局 [data-tip]:hover 气泡会在弹窗玻璃上糊出一块"阴影"
				.createEl("button", { cls: "detail-fu-del card-act", text: "删除" })
				.addEventListener("click", () => void remove(f));
		}
	}

	async function remove(f: FollowupItem & { path: string }): Promise<void> {
		const file = deps.app.vault.getAbstractFileByPath(f.path);
		if (!file) return;
		await deps.app.vault.trash(file, true); // 整条跟进笔记进回收站，可恢复
		// 等库索引确认删掉再重绘，否则 getPages 还带着旧条目（假不更新）
		await waitFor(() => !deps.getPages().some((p) => p.path === f.path));
		deps.notice("🗑 跟进已删除");
		deps.refresh();
		renderList(deps.getPages());
	}

	inp.addEventListener("keydown", (e) => {
		if (e.key !== "Enter") return;
		const v = inp.value.trim();
		if (!v) return;
		void (async () => {
			const path = await createInboxNote(
				deps.app,
				deps.inboxDir,
				deps.moment(Date.now()).format("YYYY-MM-DD-HHmmss"),
				{
					// 跟进不重新归类，领域继承自所属待办（ADR 0007：待办不作类目值）
					category: page.category || "",
					subcategory: "",
					subsubcategory: "",
					summary: v.replace(/\s+/g, " ").slice(0, 30),
					tags: [],
					status: "",
					related: `"[[${page.name}]]"`,
				},
				v,
			);
			inp.value = "";
			deps.notice("✅ 跟进已记录");
			// 等 metadataCache 解析出新笔记的 related 再重绘，否则列表查不到它
			await waitFor(() => {
				const fm = deps.app.metadataCache.getCache(path)?.frontmatter;
				return !!fm && relatedTargets(fm.related).includes(page.name);
			});
			deps.refresh();
			renderList(deps.getPages());
		})();
	});

	foot
		.createEl(
			"button",
			{ cls: "card-act act-strong", attr: { "data-tip": "标记该待办为已完成" } },
			(btn) => {
				putIcon(btn, "check-circle", ICON_BTN);
				btn.createSpan({ text: " 标记完成" });
			},
		)
		.addEventListener("click", () => {
			void (async () => {
				const f = deps.app.vault.getAbstractFileByPath(page.path);
				if (!f) return;
				await deps.app.fileManager.processFrontMatter(f, (fm) => {
					fm.status = "done";
					fm.completed = localStamp(); // 与 todo-view 完成口径一致：本地时区 24H
				});
				deps.notice("🎉 已完成");
				close();
				deps.refresh();
			})();
		});

	renderList(deps.getPages());
	// 从卡片「跟进」按钮呼出时直接聚焦输入框，落笔即记
	if (opts.focusInput) inp.focus();
}
