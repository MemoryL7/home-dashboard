/* ============================================================
   longform-view —— 长文编辑器（票 07 / 复刻旧版形态）
   旧版是 dataviewjs 在新 leaf 里动态构建的「工具栏 + textarea +
   实时预览 + 保存」视图（ADR 0002）；插件版复刻同一形态：
   - 新 leaf 打开的 ItemView，不落持久状态（getViewState 只留 type，
     重启后标签消失，草稿箱是唯一重入点——会话级语义不变）；
   - 文件实时落盘（输入防抖后 vault.modify），关开标签不丢内容；
   - 工具栏 Markdown 格式化走 applyMdAction（纯函数，Node 可测）；
   - 实时预览走 MarkdownRenderer（渲染进预览列，每次输入防抖重渲）；
   - 「归类转正」一键走 classify-core（clearStatus: true，ADR 0002：
     转正后 status 清空），成功即关标签。
   本视图根类 .lf-editor 与 Home 视图的 .home-dashboard.home-v2 互相
   独立，styles.css 的 .lf-editor 规则只作用于这个容器。
   ============================================================ */
import { ItemView, MarkdownRenderer, Modal, Notice, WorkspaceLeaf, type TFile } from "obsidian";
import type HomeDashboardPlugin from "../main";
import { splitFrontmatter, applyMdAction, type MdAction } from "./longform-core";
import { createLongformDraft, runPromote } from "./draft-ui";
import { revealLeafSafe } from "./choose-leaf";
import { putIcon, ICON_BTN } from "./icon";

/** 编辑器视图类型（仅本会话内有效——见文件头注释）。 */
export const LONGFORM_VIEW_TYPE = "home-dashboard-longform-editor";

/** 自动保存/预览防抖间隔（ms）：手停即存即渲，又不逐键打盘。 */
const DEBOUNCE_MS = 600;

/** 工具栏按钮清单（label 直白优先于图标——不依赖图标包）。 */
const TOOLBAR: { label?: string; icon?: string; action: MdAction; title: string }[] = [
	{ label: "B", action: "bold", title: "加粗" },
	{ label: "I", action: "italic", title: "斜体" },
	{ label: "H", action: "heading", title: "标题" },
	{ label: "•", action: "list", title: "列表" },
	{ icon: "quote", action: "quote", title: "引用" },
	{ label: "‹›", action: "code", title: "行内代码" },
	{ icon: "link", action: "link", title: "链接" },
];

/** 打开（或聚焦）某草稿的编辑器标签。 */
export async function openLongformEditor(plugin: HomeDashboardPlugin, file: TFile): Promise<void> {
	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({ type: LONGFORM_VIEW_TYPE, active: true, state: { file: file.path } });
	await revealLeafSafe(plugin.app.workspace, leaf);
}

/** 「新建长文」标题弹窗：定标题 → 建草稿文件 → 进编辑器。 */
export class LongformTitleModal extends Modal {
	private plugin: HomeDashboardPlugin;
	private opened = false;

	constructor(plugin: HomeDashboardPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.titleEl.setText("新增长文");
		const input = this.contentEl.createEl("input", {
			attr: { placeholder: "标题（可留空，落「未命名」）" },
		});
		input.addClass("hd-form-input");
		const foot = this.contentEl.createDiv({ cls: "hd-form-footer" });
		const button = foot.createEl("button", { text: "开始写作" });
		const submit = (): void => {
			if (this.opened) return;
			this.opened = true;
			void this.create(input.value, button);
		};
		button.addEventListener("click", submit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") submit();
		});
		window.setTimeout(() => input.focus(), 50);
	}

	private async create(title: string, button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		try {
			const file = await createLongformDraft(this.plugin, title);
			this.close();
			await openLongformEditor(this.plugin, file);
		} finally {
			button.disabled = false;
		}
	}
}

export class LongformEditorView extends ItemView {
	private plugin: HomeDashboardPlugin;
	private filePath: string | null = null;
	private file: TFile | null = null;
	/** 打开时留存的 frontmatter 围栏（含结尾换行）；正文写盘时拼回。 */
	private fm = "";
	/** 脏正文缓存；null = 与文件一致（清空全文也要能落盘，所以不用空串判断）。 */
	private dirty: string | null = null;
	private saveTimer: number | null = null;
	private previewTimer: number | null = null;
	private textarea: HTMLTextAreaElement | null = null;
	private previewEl: HTMLElement | null = null;
	private hintEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: HomeDashboardPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return LONGFORM_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file ? this.file.basename : "长文编辑器";
	}

	getIcon(): string {
		return "edit";
	}

	// 会话级（ADR 0002）：不序列化 file——重启后此标签恢复不出编辑器，
	// 从草稿箱重进才是正道
	getViewState(): { type: string; state?: Record<string, unknown> } {
		return { type: LONGFORM_VIEW_TYPE };
	}

	async setState(state: { file?: string }): Promise<void> {
		this.filePath = state.file ?? null;
		await this.renderEditor();
	}

	getState(): { file?: string } {
		return this.filePath ? { file: this.filePath } : {};
	}

	private async renderEditor(): Promise<void> {
		const path = this.filePath;
		this.file = path ? (this.app.vault.getAbstractFileByPath(path) as TFile | null) : null;
		if (!this.file) {
			// 状态丢了（重启恢复/文件被删）：会话级语义下不留空壳，标签自杀
			new Notice("❌ 草稿文件不存在，从草稿箱重进");
			this.leaf.detach();
			return;
		}
		this.contentEl.empty();
		const root = this.contentEl.createDiv({ cls: "lf-editor" });
		// 标签页标题由 getDisplayText 随 this.file 自动更新，这里不动头部

		// 工具栏：Markdown 格式化（applyMdAction 纯函数应用后整段回填）
		const bar = root.createDiv({ cls: "lf-bar" });
		for (const t of TOOLBAR) {
			bar.createEl("button", {
				cls: "lf-btn",
				attr: { "data-tip": t.title },
			}, (btn) => {
				if (t.icon) putIcon(btn, t.icon, ICON_BTN);
				else btn.createSpan({ text: t.label });
			}).addEventListener("click", () => this.format(t.action));
		}
		bar.createDiv({ cls: "lf-bar-gap" });
		const promote = bar.createEl("button", {
			cls: "lf-btn lf-promote",
			attr: { "data-tip": "AI 归类：写入 frontmatter、更新总索引并移出草稿态" },
		}, (btn) => {
			putIcon(btn, "square-check", ICON_BTN);
			btn.createSpan({ text: " AI 归类转正" });
		});
		promote.addEventListener("click", () => void this.promote(promote));

		// 编辑区：左 textarea 右实时预览（MarkdownRenderer 渲染）
		const split = root.createDiv({ cls: "lf-split" });
		const input = split.createEl("textarea", {
			cls: "lf-input",
			attr: { placeholder: "正文实时保存…（AI 归类转正后移出草稿箱）" },
		});
		this.textarea = input;
		// markdown-rendered 类让主题的预览样式（标题/列表/代码块…）作用于预览列
		this.previewEl = split.createDiv({ cls: "lf-preview markdown-rendered" });

		// 落盘状态提示 + 实时落盘
		const foot = root.createDiv({ cls: "lf-foot" });
		this.hintEl = foot.createSpan({ cls: "lf-hint" });
		this.setHint(this.file.stat.mtime);

		const full = await this.app.vault.read(this.file);
		if (this.filePath !== path) return; // 已关/已换成别的文件
		const [fm, body] = splitFrontmatter(full);
		this.fm = fm;
		input.value = body;
		input.addEventListener("input", () => {
			this.dirty = input.value;
			this.scheduleSave();
			this.schedulePreview(input.value);
		});
		this.renderPreview(body);
	}

	/** 工具栏动作：按当前选区应用格式化，整段回填并恢复选区。 */
	private format(action: MdAction): void {
		const input = this.textarea;
		if (!input) return;
		const r = applyMdAction(input.value, input.selectionStart, input.selectionEnd, action);
		input.value = r.text;
		input.setSelectionRange(r.start, r.end);
		input.focus();
		this.dirty = r.text;
		this.scheduleSave();
		this.schedulePreview(r.text);
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => void this.save(), DEBOUNCE_MS);
	}

	/** 预览防抖：正文由调用方传入（input 当前值），不依赖 dirty 标记——
	    落盘与预览两个同延时定时器一批触发时 save 会先清 dirty，
	    预览若读 dirty 就永远跳帧，表现为「打字不更新预览」。 */
	private schedulePreview(body: string): void {
		if (this.previewTimer !== null) window.clearTimeout(this.previewTimer);
		this.previewTimer = window.setTimeout(() => {
			this.previewTimer = null;
			this.renderPreview(body);
		}, DEBOUNCE_MS);
	}

	/** 实时预览：MarkdownRenderer 渲染进预览列（每次整列重渲）。 */
	private renderPreview(body: string): void {
		const el = this.previewEl;
		if (!el || !this.file) return;
		// setViewState 阶段视图尚未挂到 DOM，等一帧挂载完再渲（首次打开的关键）
		if (!el.isConnected) {
			window.requestAnimationFrame(() => this.renderPreview(body));
			return;
		}
		el.empty();
		MarkdownRenderer.render(this.app, body, el, this.file.path, this).catch(
			(e: Error) => new Notice(`❌ 预览渲染失败: ${e.message}`),
		);
	}

	/** 实时落盘：把缓存的脏正文拼回 frontmatter 写回文件（无脏内容则跳过）。 */
	private async save(): Promise<void> {
		this.saveTimer = null;
		if (this.dirty === null || !this.file) return;
		const text = this.fm + this.dirty;
		this.dirty = null;
		await this.app.vault.modify(this.file, text);
		this.setHint(Date.now());
	}

	private setHint(mtime: number): void {
		this.hintEl?.setText(`已存 ${new Date(mtime).toLocaleTimeString()}`);
	}

	/** 一键归类转正：frontmatter 写入 + 总索引更新 + 移出草稿态，成功即关标签。 */
	private async promote(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		try {
			if (this.saveTimer !== null) {
				window.clearTimeout(this.saveTimer);
				this.saveTimer = null;
			}
			await this.save();
			if (this.file) {
				const ok = await runPromote(this.plugin, this.file);
				if (ok) this.leaf.detach();
			}
		} finally {
			button.disabled = false;
		}
	}

	async onClose(): Promise<void> {
		// 关标签瞬间还压着防抖的尾巴，同步冲盘，保证「关开不丢内容」
		for (const t of ["saveTimer", "previewTimer"] as const) {
			if (this[t] !== null) {
				window.clearTimeout(this[t] as number);
				this[t] = null;
			}
		}
		void this.save();
		this.textarea = null;
		this.previewEl = null;
		this.hintEl = null;
	}
}
