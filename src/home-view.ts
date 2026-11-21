import { ItemView, MarkdownRenderer, Notice, WorkspaceLeaf, moment, normalizePath, requestUrl, type TFile } from "obsidian";
import { HOME_VIEW_TYPE } from "./lib/choose-leaf";
import type HomeDashboardPlugin from "./main";
import { runCapture } from "./lib/capture-ui";
import { mountGarden, type GardenMount } from "./lib/garden-dom";
import { renderDaylogCard, type DaylogCard } from "./lib/daylog-view";
import { resolveConventions } from "./lib/conventions";
import { PROFILE_DEFAULTS } from "./lib/profile";
import { isImagePath, resolveImportPath, LOGO_HINT, LOGO_DIR_DEFAULT } from "./lib/logo-core";
import { ImageSuggestModal } from "./lib/logo-ui";
import { collectInbox, snapshotVault, type InboxPage } from "./lib/inbox-query";
import { renderSidePanel, renderRecentCard } from "./lib/stats-view";
import { statsCore } from "./lib/stats-core";
import { pendingTodos } from "./lib/todo-core";
import { openDetailModal, closeDetailModal, type DetailPageLike } from "./lib/detail-modal";
import { renderDraftCard, type DraftCard } from "./lib/draft-view";
import { renderTodoCard, type TodoCard } from "./lib/todo-view";
import { classify } from "./lib/classify-core";
import { DEFAULT_CLASSIFY_PROMPT } from "./lib/prompts";
import { putIcon, ICON_TITLE, ICON_BTN } from "./lib/icon";

/**
 * The Home view. Everything the view renders lives inside a single root
 * element carrying the `.home-dashboard.home-v2` classes. styles.css must
 * prefix every rule with `.home-dashboard.home-v2` so plugin styles can never
 * leak into ordinary markdown pages — this is the repo's composite-selector
 * convention (structural override lives in the second class as the plugin
 * evolves).
 */
export class HomeView extends ItemView {
	private plugin: HomeDashboardPlugin;
	private garden: GardenMount | null = null;
	private daylog: DaylogCard | null = null;
	private recentEl: HTMLElement | null = null;
	private sideStatsEl: HTMLElement | null = null;
	private capsuleEl: HTMLElement | null = null;
	private profileEl!: HTMLElement;
	private draftCard: DraftCard | null = null;
	private todoCard: TodoCard | null = null;
	private lastStatsFingerprint = "";

	constructor(leaf: WorkspaceLeaf, plugin: HomeDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return HOME_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Home";
	}

	getIcon(): string {
		return "home";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl.createDiv({
			cls: "home-dashboard home-v2",
		});
		// 竹园场景（背景/飘叶/赏竹）：挂进视图根容器——与卡片同一 backdrop 取样树，
		// 卡片才能 blur 到竹子；mountGarden 负责 body.home-v2 全局标记的增删
		this.garden = mountGarden(root);
		// 双列栅格骨架：页头横贯两列（品牌只出现这一处），左侧栏 sticky 个人面板，
		// 右主区四个分区（今天/行动/记录/洞察）
		const dash = root.createDiv({ cls: "dash" });
		// 页头：左 Logo+品牌、右日期状态胶囊（文字由 refreshStats 按快照填）
		const header = dash.createDiv({ cls: "hd-header" });
		const brand = header.createDiv({ cls: "hd-brand" });
		this.profileEl = brand.createDiv({ cls: "hd-logo" });
		this.renderProfile();
		const brandText = brand.createDiv({ cls: "hd-brand-text" });
		brandText.createDiv({
			cls: "hd-name",
			text: this.plugin.settings.profileName.trim() || PROFILE_DEFAULTS.name,
		});
		brandText.createDiv({
			cls: "hd-tag",
			text: this.plugin.settings.profileTagline.trim() || PROFILE_DEFAULTS.tagline,
		});
		this.capsuleEl = header.createDiv({ cls: "hd-capsule" });
		const side = dash.createDiv({ cls: "side" });
		const main = dash.createDiv({ cls: "main" });
		// 侧栏：一张连贯卡片，内部模块（速览/打卡/洞察/大类/热力）由
		// refreshStats 清空重建；CSS 用分隔线分模块，无分区大标题
		const panel = side.createDiv({ cls: "side-panel dash-card card-bamboo" });
		this.sideStatsEl = panel;
		// 分区辅助：统一的分区标题行（12px 小标题 + 弹性细分隔线 + 灰提示语）
		const section = (title: string, hint: string): HTMLElement => {
			const sec = main.createDiv({ cls: "sec" });
			const head = sec.createDiv({ cls: "sec-head" });
			head.createSpan({ cls: "sec-title", text: title });
			head.createDiv({ cls: "sec-line" });
			head.createSpan({ cls: "sec-hint", text: hint });
			return sec.createDiv({ cls: "sec-body" });
		};
		const conventions = resolveConventions(this.plugin.settings);
		// 「今 天」：时间轴卡（票 05），色带滑动选格落盘 Inbox 日文件（ADR 0005/0006）
		const daylogRoot = section("今 天", "当天的状态与投入").createDiv({ cls: "dl-root" });
		this.daylog = renderDaylogCard(daylogRoot, {
			app: this.app,
			moment,
			notice: (msg) => new Notice(msg, 3000),
			conventions,
			onSaved: () => this.refreshStats(),
		});
		// 「行 动」：待办卡 7 : 最近新增 feed 卡 5 两列并排
		const cols = section("行 动", "要推进的事").createDiv({ cls: "sec-cols" });
		const todoRoot = cols.createDiv({ cls: "col-todo" });
		this.todoCard = renderTodoCard(todoRoot, {
			app: this.app,
			inboxDir: conventions.inboxDir,
			classify: (file, opts) =>
				classify(this.app, requestUrl, file, {
					ai: {
						apiUrl: this.plugin.settings.apiUrl,
						apiKey: this.plugin.settings.apiKey,
						model: this.plugin.settings.aiModel,
					},
					prompt:
						this.plugin.settings.classifyPrompt.trim() || DEFAULT_CLASSIFY_PROMPT,
					indexDir: conventions.indexDir,
					clearStatus: opts?.clearStatus,
					notice: (msg) => new Notice(msg, 3000),
				}),
			moment: (t) => moment(t),
			notice: (msg) => new Notice(msg, 3000),
			refresh: () => this.refreshStats(),
			showDetail: (p, opts) => this.showDetail(p, opts),
		});
		// 最近新增 feed：容器先占位，refreshStats 清空重建
		this.recentEl = cols.createDiv({ cls: "col-recent" });
		// 「记 录」：随手记输入卡与草稿箱上下拼合成一个整体（record-combo）
		const recordBody = section("记 录", "随手记直落笔记，长文可暂存草稿箱");
		const combo = recordBody.createDiv({ cls: "record-combo" });
		this.renderCaptureCard(combo);
		// 草稿箱卡（票 07）：新建/继续写作长文，会话级 Modal 编辑器
		// （ADR 0002 会话级语义不变），归类转正走 classify-core。
		// 独立容器——refreshStats 不连带抹掉草稿列表
		const draftRoot = combo.createDiv({ cls: "draft-root" });
		this.draftCard = renderDraftCard(draftRoot, {
			app: this.app,
			plugin: this.plugin,
			moment,
			notice: (msg) => new Notice(msg, 3000),
			onChanged: () => this.refreshStats(),
		});
		// 「洞 察」：AI 周回顾卡置于页面底部（不在首屏）
		const insightBody = section("洞 察", "AI 帮你回顾一周");
		this.renderReviewCard(insightBody);
		this.refreshStats();
		// 普通编辑触发 changed/create/delete/rename（resolved 只在启动/大改动后
		// 整体解析完时触发，漏掉日常改 frontmatter），统计卡才始终与库内数据一致
		const refresh = (): void => {
			this.refreshStats();
			this.draftCard?.refresh();
		};
		this.registerEvent(this.app.metadataCache.on("resolved", refresh));
		this.registerEvent(this.app.metadataCache.on("changed", refresh));
		this.registerEvent(this.app.vault.on("create", refresh));
		this.registerEvent(this.app.vault.on("delete", refresh));
		this.registerEvent(this.app.vault.on("rename", refresh));
	}

	/** 最新库内页面快照（统计/待办/最近/详情弹窗共用一份口径）。 */
	private collectPages(): InboxPage[] {
		const conventions = resolveConventions(this.plugin.settings);
		return collectInbox(
			snapshotVault(
				this.app.vault.getMarkdownFiles(),
				(f) => this.app.metadataCache.getFileCache(f as TFile),
			),
			conventions.inboxDir,
		);
	}

	/** 详情弹窗接线：浮层挂视图根（玻璃同款取样树），数据变化后弹窗内重取快照。 */
	private showDetail(page: DetailPageLike, opts: { focusInput?: boolean } = {}): void {
		openDetailModal(
			{
				app: this.app,
				root: this.contentEl.querySelector<HTMLElement>(".home-dashboard.home-v2")!,
				component: this,
				getPages: () => this.collectPages(),
				refresh: () => this.refreshStats(),
				inboxDir: resolveConventions(this.plugin.settings).inboxDir,
				moment: (t) => moment(t),
				notice: (msg) => new Notice(msg, 3000),
				renderMarkdown: (el, md, path) =>
					MarkdownRenderer.render(this.app, md, el, path, this),
			},
			page,
			opts,
		);
	}

	/** 重新查询库并重绘侧栏面板/最近新增/日期胶囊（清空重建，无状态可丢）。 */
	private refreshStats(): void {
		const pages = this.collectPages();
		// 指纹没变就不重绘：changed 事件很频（每次编辑都触发），
		// 盲重建会让热力图/滚动位置来回闪。整对象序列化，避免手拼字段
		// 漏掉 InboxPage 新增列（如 summary 改了文案但指纹没变）
		const fingerprint = JSON.stringify(pages);
		if (fingerprint === this.lastStatsFingerprint) return;
		this.lastStatsFingerprint = fingerprint;
		this.todoCard?.refresh(pages);
		renderSidePanel(this.sideStatsEl!, pages, moment);
		renderRecentCard(this.recentEl!, pages, moment, {
			showDetail: (p, opts) => this.showDetail(p, opts),
		});
		if (this.capsuleEl) {
			// 口径与侧栏共用 stats-core（一份按天计数），待办数走 todo-core
			const todayStr = moment().format("YYYY-MM-DD");
			const wk = "周" + "日一二三四五六"[moment().day()];
			const counts = statsCore().dayCounts(pages, (p) => p.ctime, (ms) => moment(ms).format("YYYY-MM-DD"));
			const todayCount = counts[todayStr] || 0;
			const pending = pendingTodos(pages).length;
			this.capsuleEl.setText(`${todayStr} ${wk} · 已记 ${todayCount} 条 · 待办 ${pending}`);
		}
	}

	/** 页头 Logo（ADR 0003 数据源 = 插件设置，票 10）：库内图片路径渲染图片，
	 *  否则当作字符图标；缺省用内置默认。logo 是交互入口：点击弹库内图片
	 *  模糊选择器，拖入/粘贴本机图片自动拷进设置约定的 logoDir（默认 .assets
	 *  点目录，文件树不可见）。设置页改 profile 后经 refreshProfile() 就地重绘。 */
	refreshProfile(): void {
		this.renderProfile();
	}

	private renderProfile(): void {
		const prof = this.profileEl;
		prof.empty();
		const s = this.plugin.settings;
		const name = s.profileName.trim() || PROFILE_DEFAULTS.name;
		const logo = s.profileLogo.trim() || PROFILE_DEFAULTS.logo;
		const logoEl =
			isImagePath(logo)
				? (() => {
						const img = prof.createEl("img", {
							cls: "hd-logo-img",
							attr: { alt: name, "data-tip": LOGO_HINT },
						});
						// adapter.getResourcePath 不走文件索引——点目录（.assets 等）
						// 不进 vault 索引，getAbstractFileByPath 查不到，必须走这里
						img.src = this.app.vault.adapter.getResourcePath(logo);
						return img;
					})()
				: prof.createDiv({ cls: "hd-logo-char", text: logo, attr: { "data-tip": LOGO_HINT } });
		logoEl.addClass("sp-logo-pick");
		this.wireLogoPicker(logoEl);
	}

	/** logo 交互接线：点击 → 模糊选择器；拖入 → 内部拖拽取库内路径、
	 *  外部文件拷进 logoDir；粘贴 → 同外部文件。路径改动统一走 setLogo。 */
	private wireLogoPicker(el: HTMLElement): void {
		el.addEventListener("click", () => {
			new ImageSuggestModal(this.app, (f) => void this.setLogo(f.path)).open();
		});
		el.addEventListener("dragover", (e) => {
			e.preventDefault();
			el.addClass("sp-logo-drag");
		});
		el.addEventListener("dragleave", () => el.removeClass("sp-logo-drag"));
		el.addEventListener("drop", (e) => {
			e.preventDefault();
			el.removeClass("sp-logo-drag");
			const dt = e.dataTransfer;
			if (!dt) return;
			// 库内拖拽：dataTransfer 带的是 vault 相对路径
			const internal = dt.getData("text/plain");
			if (internal && isImagePath(internal)) {
				void this.setLogo(internal);
				return;
			}
			const file = dt.files?.[0];
			if (file) void this.importExternal(file);
		});
	}

	/** 本机图片导入：resolveImportPath 定不冲突落点（logoDir 默认 .assets），
	 *  目录不存在则建，createBinary 落盘后写回设置并就地重绘。 */
	private async importExternal(file: File): Promise<void> {
		const dir =
			this.plugin.settings.logoDir.trim() || LOGO_DIR_DEFAULT;
		const dirPath = normalizePath(dir);
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(dirPath))) {
			await adapter.mkdir(dirPath);
		}
		const target = await resolveImportPath(adapter, dirPath, file.name);
		const data = await file.arrayBuffer();
		await this.app.vault.createBinary(normalizePath(target), data);
		await this.setLogo(target);
	}

	private async setLogo(path: string): Promise<void> {
		this.plugin.settings.profileLogo = path;
		await this.plugin.saveSettings();
		this.renderProfile();
	}

	/** 随手记输入卡（记 录 分区上卡）：textarea + AI 归档按钮（Ctrl+Enter 提交）。 */
	private renderCaptureCard(root: HTMLElement): void {
		const card = root.createDiv({ cls: "cap-card" });
		const input = card.createEl("textarea", {
			cls: "cap-input",
			attr: { placeholder: "随手记点什么…（Ctrl+Enter 快速归档）" },
		});
		const foot = card.createDiv({ cls: "cap-foot" });
		foot.createSpan({
			cls: "cap-hint",
			text: "回车换行，写完点「AI 归档」——随手记直落笔记并自动归类索引",
		});
		const button = foot.createEl("button", {
			cls: "card-act act-strong",
			attr: { "data-tip": "保存为笔记并执行 AI 归类（Ctrl+Enter 同）" },
		}, (btn) => {
			putIcon(btn, "sparkles", ICON_BTN);
			btn.createSpan({ text: " AI 归档" });
		});
		const submit = (): void => {
			void this.submitCapture(input.value, button, () => {
				input.value = "";
			});
		};
		button.addEventListener("click", submit);
		// Ctrl+Enter 归档：部分中文输入法会吞掉 keydown 里的 Ctrl 修饰键（只剩
		// Enter、插了换行），所以 keydown/keyup 双听 + keyCode 10（LF，Ctrl+Enter
		// 的历史值）兜底；命中即 preventDefault，避免白插一个换行
		const hitCtrlEnter = (e: KeyboardEvent): boolean =>
			(e.ctrlKey || e.metaKey) &&
			(e.key === "Enter" || e.code === "Enter" || e.keyCode === 10);
		let submitting = false;
		const trySubmit = (): void => {
			if (submitting) return; // 归档异步，输入框要等分类完成才清空，防 keyup 重复提交
			submitting = true;
			submit();
			window.setTimeout(() => (submitting = false), 500);
		};
		input.addEventListener("keydown", (e) => {
			if (hitCtrlEnter(e)) {
				e.preventDefault();
				trySubmit();
			}
		});
		input.addEventListener("keyup", (e) => {
			if (hitCtrlEnter(e)) trySubmit();
		});
	}

	/** 周回顾卡：一键生成近 7 天随手记的 AI 回顾（同周覆盖周文件）+ 空状态提示。 */
	private renderReviewCard(root: HTMLElement): void {
		const card = root.createDiv({ cls: "review-card card-bamboo" });
		const head = card.createDiv({ cls: "review-head" });
		head.createSpan({ cls: "review-title" }, (t) => {
			putIcon(t, "book-open", ICON_TITLE);
			t.createSpan({ text: " AI 周回顾" });
		});
		head.createSpan({
			cls: "review-hint",
			text: "近 7 天随手记 → 观察与建议",
		});
		const button = head.createEl("button", {
			cls: "card-act act-strong",
			text: "生成本周回顾",
			attr: { "data-tip": "生成近 7 天随手记的 AI 周回顾（Reviews/ 同周覆盖）" },
		});
		button.addEventListener("click", () => {
			void this.submitReview(button);
		});
		card.createDiv({
			cls: "review-empty",
			text: "本周尚未生成回顾。生成后将在此展示近 7 天的观察、习惯建议与待办回收。",
		});
	}

	private async submitReview(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		try {
			await this.plugin.runWeeklyReview();
		} finally {
			button.disabled = false;
		}
	}

	private async submitCapture(
		text: string,
		button: HTMLButtonElement,
		onDone: () => void,
	): Promise<void> {
		button.disabled = true;
		try {
			await runCapture(this.plugin, text, onDone);
		} finally {
			button.disabled = false;
		}
	}

	async onClose(): Promise<void> {
		// 先停场景（rAF/点击监听/body 全局标记）与时间轴的 document 监听，再清容器
		closeDetailModal(); // 详情弹窗的 Esc 监听挂 document，随视图一起摘
		this.garden?.destroy();
		this.daylog?.destroy();
		this.daylog = null;
		this.todoCard?.destroy();
		this.todoCard = null;
		this.draftCard = null;
		this.garden = null;
		this.contentEl.empty();
	}
}
