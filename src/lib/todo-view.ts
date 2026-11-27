/* ============================================================
   todo-view —— 待办卡（✅ 待办）：新建 / 跟进 / 完成。
   行为自旧 Home.md 的待办卡原样迁入（与插件化 Spec 的用户故事对齐）：
   - 新建：Inbox 落 status: pending 的待办笔记 → AI 归类（clearStatus:false
     保留 pending）→ 列表刷新；
   - 跟进：新笔记 related 关联原待办，回车记录，不算完成；
   - 完成：frontmatter.status 置 done + completed 记本地完成时刻；页脚统计本周完成条数。
   DOM 组装 + 薄事件接线；数据口径与 stats-view 同一份 InboxPage
   （collectInbox），由宿主 refresh() 驱动重绘。
   ============================================================ */
import { localStamp } from "./classify-core";
import { putIcon, ICON_TITLE, ICON_BTN } from "./icon";
import { enableDragScroll } from "./drag-scroll";
import { activeTodos, doneInWeek, followupCounts } from "./todo-core";
import { createInboxNote } from "./note-create";
import type { DetailPageLike } from "./detail-modal";

/** classify-core 的最小文件切片（与 lib/classify-core.ts 的 TFileLike 同形）。 */
export interface TodoFileLike {
	path: string;
	name: string;
}

/** vault/文件管理的最小切片（注入便于 Node 侧测试）。 */
export interface TodoAppLike {
	vault: {
		create(path: string, data: string): Promise<TodoFileLike>;
		getAbstractFileByPath(path: string): TodoFileLike | null;
		adapter: {
			exists(path: string): Promise<boolean>;
			mkdir(path: string): Promise<void>;
		};
	};
	metadataCache: {
		getCache(path: string): { frontmatter?: Record<string, unknown> | null } | null;
	};
	fileManager: {
		processFrontMatter(
			file: TodoFileLike,
			fn: (fm: Record<string, unknown>) => void,
		): Promise<void>;
	};
	workspace: {
		openLinkText(path: string, origin: string, newLeaf: boolean): Promise<unknown>;
	};
}

export interface TodoPageLike {
	path: string;
	name: string;
	ctime: number;
	summary: string;
	category: string;
	status: string;
	related: unknown;
	/** 完成时刻（ms，fm.completed 解析而来）；旧数据无此字段为 0。 */
	completed: number;
}

export interface TodoDeps {
	app: TodoAppLike;
	/** AI 归类（接线由宿主组装：settings + requestUrl + prompt）。 */
	classify(file: TodoFileLike, opts?: { clearStatus?: boolean }): Promise<boolean>;
	/** 落点目录约定（Inbox/）。 */
	inboxDir: string;
	moment: (t: number) => { format(fmt: string): string };
	notice: (msg: string) => void;
	/** 待办数据变化后由宿主调用（重绘列表）。 */
	refresh: () => void;
	/** 点击待办行/跟进按钮 → 详情弹窗（focusInput 让弹窗直接聚焦记跟进输入框）。 */
	showDetail: (page: TodoPageLike, opts?: { focusInput?: boolean }) => void;
	/** 放大按钮 → 打开放大视图（宿主接 todo-expanded，覆盖 Home 全部块区域）。 */
	openExpanded: () => void;
}

export interface TodoCard {
	/** 用新的页面快照重绘列表。 */
	refresh(pages: TodoPageLike[]): void;
	/** 视图卸载时清理（暂无全局监听，占位与 daylog/draft 卡对齐）。 */
	destroy(): void;
}

/** relatedTargets 等待办策略已收敛到 todo-core（本文件只做渲染与接线）。 */
const waitFor = async (pred: () => boolean, timeout = 5000): Promise<boolean> => {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (pred()) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
};

export function renderTodoCard(parent: HTMLElement, deps: TodoDeps): TodoCard {
	const card = parent.createDiv({ cls: "dash-card card-bamboo todo-card" });
	const head = card.createDiv({ cls: "todo-head" });
	const h3 = head.createEl("h3");
	putIcon(h3, "square-check", ICON_TITLE);
	h3.createSpan({ text: "待办" });
	const headHint = head.createSpan({ cls: "todo-head-hint" });
	// 放大入口（IKY82E）：Lucide maximize-2，覆盖 Home 全部块区域的放大视图
	const expandBtn = head.createEl("button", { cls: "card-act todo-expand" });
	putIcon(expandBtn, "maximize-2", ICON_BTN);
	expandBtn.addEventListener("click", () => deps.openExpanded());

	// 卡内跟进行已移除：「跟进」按钮改呼详情弹窗记跟进（弹窗聚焦输入框），
	// 记/删跟进统一在弹窗内完成

	// 列表滚动区：内容超高时内部滚动，底部新建行固定在卡底（flex 布局见 styles.css）
	const todoBody = card.createDiv({ cls: "todo-body" });
	enableDragScroll(todoBody); // 滚动条已隐藏，补鼠标按住拖拽滚动
	let lastPages: TodoPageLike[] = [];

	// 新建行：列表底部的虚线输入框（回车创建）
	const newRow = card.createDiv({ cls: "todo-new" });
	const inp = newRow.createEl("input", {
		cls: "todo-input",
		attr: { type: "text", placeholder: "输入待办，回车创建" },
	});

	// 落盘公共件收进 note-create（详情弹窗记跟进复用同款 frontmatter 落盘）
	const createNote = (meta: Record<string, unknown>, body: string): Promise<string> =>
		createInboxNote(
			deps.app,
			deps.inboxDir,
			deps.moment(Date.now()).format("YYYY-MM-DD-HHmmss"),
			meta,
			body,
		);

	async function submitNew(): Promise<void> {
		const v = inp.value.trim();
		if (!v) return;
		const path = await createNote(
			{
				category: "",
				subcategory: "",
				subsubcategory: "",
				summary: v.replace(/\s+/g, " ").slice(0, 30),
				tags: [],
				status: "pending",
			},
			v,
		);
		inp.value = "";
		deps.notice("✅ 待办已创建，AI 归类中…");
		await waitFor(
			() => deps.app.metadataCache.getCache(path)?.frontmatter?.status === "pending",
		);
		// AI 归类（clearStatus:false 保留 pending；prompt 对待办也会返回 pending）
		const f = deps.app.vault.getAbstractFileByPath(path);
		if (f) await deps.classify(f, { clearStatus: false });
		deps.refresh();
	}
	inp.addEventListener("keydown", (e) => {
		if (e.key === "Enter") void submitNew();
	});

	async function complete(p: TodoPageLike): Promise<void> {
		const f = deps.app.vault.getAbstractFileByPath(p.path);
		if (!f) return;
		await deps.app.fileManager.processFrontMatter(f, (fm) => {
			fm.status = "done";
			fm.completed = localStamp(); // 本地时区 24H，完成时间入档
		});
		deps.notice("🎉 已完成");
		await waitFor(
			() => deps.app.metadataCache.getCache(p.path)?.frontmatter?.status === "done",
		);
		deps.refresh();
	}

	// 行点击 → 详情弹窗（原 openLinkText 跳转按需求移除，弹窗即详情入口）
	const linkTo = (p: TodoPageLike): HTMLAnchorElement => {
		const a = document.createElement("a");
		a.className = "internal-link";
		a.textContent = p.summary || p.name;
		a.addEventListener("click", (ev) => {
			ev.preventDefault();
			deps.showDetail(p);
		});
		return a;
	};

	function render(pages: TodoPageLike[]): void {
		todoBody.empty();
		// 活跃待办（pending + doing）：进行中的事与未开始的一起速览（口径在 todo-core）
		const pending = activeTodos(pages);
		// 本周已完成：优先用完成时刻；旧数据无 completed 字段回退 ctime（口径在 todo-core）
		const doneCount = doneInWeek(pages, Date.now());
		const fuCounts = followupCounts(pages);
		const ul = todoBody.createDiv({ cls: "todo-list" });
		for (const p of pending) {
			const row = ul.createDiv({ cls: "todo-row" });
			const mainRow = row.createDiv({ cls: "todo-main" });
			mainRow.appendChild(linkTo(p));
			const fu = fuCounts[p.name] ?? 0;
			const ops = row.createDiv({ cls: "todo-ops" });
			// 日期/跟进数固定靠右，紧贴「跟进」按钮左侧，不跟在标题后面
			ops.createEl("span", {
				text: `${deps.moment(p.ctime).format("MM-DD")} · ${fu}条跟进`,
				cls: "todo-meta",
			});
			// 跟进/完成合并为一个按钮，内部两段可点击区用竖杠分隔（纯展示，逻辑不变）。
			// 二级按钮样式：复用主页 .card-act（层级 2）
			const combo = ops.createEl("button", { cls: "todo-op todo-combo card-act" });
			const fseg = combo.createSpan({ text: "跟进", cls: "todo-seg" });
			fseg.addEventListener("click", () => deps.showDetail(p, { focusInput: true }));
			combo.createSpan({ text: "|", cls: "todo-sep" });
			const cseg = combo.createSpan({ text: "完成", cls: "todo-seg todo-done" });
			cseg.addEventListener("click", () => void complete(p));
		}
		if (!pending.length) {
			ul.createDiv({ cls: "todo-empty", text: "🌿 待办清零，竹林清净" });
		}
		headHint.setText(`本周已完成 ${doneCount} 条`);
		// 超过 5 条时列表区限高，其余靠滚动查看（行高等一致，按首行高度折算）。
		// 测量放到下一帧：渲染当时卡片可能还没完成布局，offsetHeight 会拿到 0，
		// 限高就设不上（表现为全部行直接铺开）。offsetHeight 会取整，行高带小数
		// 时 5 行累计少算几像素，加 4px 余量补回（远小于一行高度，不会露出第 6 行）。
		const MAX_VISIBLE = 5;
		if (pending.length > MAX_VISIBLE) {
			requestAnimationFrame(() => {
				const first = ul.firstElementChild as HTMLElement | null;
				const h = first?.offsetHeight ?? 0;
				// 直接赋 style.maxHeight：setCssProps 走 setProperty，驼峰键会被静默丢弃
				if (h > 0) todoBody.style.maxHeight = `${h * MAX_VISIBLE + 4}px`;
			});
		} else {
			todoBody.style.maxHeight = "";
		}
	}

	render(lastPages);

	return {
		refresh(pages: TodoPageLike[]): void {
			lastPages = pages;
			render(pages);
		},
		destroy(): void {
			// 无全局监听；与 daylog/draft 卡的卸载语义对齐保留占位
		},
	};
}
