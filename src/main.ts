import { Plugin, Notice, WorkspaceLeaf, requestUrl } from "obsidian";
import { HomeView } from "./home-view";
import { chooseLeaf, HOME_VIEW_TYPE } from "./lib/choose-leaf";
import { LongformEditorView, LONGFORM_VIEW_TYPE } from "./lib/longform-view";

import {
	DEFAULT_SETTINGS,
	HomeDashboardSettingTab,
	type HomeDashboardSettings,
} from "./settings";
import { ensureDirs } from "./lib/init";
import { resolveConventions } from "./lib/conventions";
import { CaptureModal } from "./lib/capture-modal";
import { generateWeeklyReview } from "./lib/weekly-review";
import { DEFAULT_REVIEW_PROMPT } from "./lib/prompts";
import { BODY_CLEANUP_CLASSES, shouldOpenOnStartup } from "./lib/lifecycle-core";
export default class HomeDashboardPlugin extends Plugin {
	settings!: HomeDashboardSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			HOME_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new HomeView(leaf, this),
		);
		// 长文编辑器（票 07）：新 leaf 的会话级视图（ADR 0002），不落持久状态
		this.registerView(
			LONGFORM_VIEW_TYPE,
			(leaf: WorkspaceLeaf) => new LongformEditorView(leaf, this),
		);

		// First-run initialization: convention directories (Inbox/, _Index/).
		await ensureDirs(this.app.vault.adapter, resolveConventions(this.settings));

		this.addRibbonIcon("home", "打开 Home 视图", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-home-view",
			name: "打开 Home 视图",
			callback: () => {
				void this.activateView();
			},
		});

		this.addCommand({
			id: "quick-capture-ai",
			name: "随手记 + AI 归类",
			callback: () => {
				new CaptureModal(this).open();
			},
		});

		// AI 周回顾（票 08）：近 7 天随手记 → 观察与建议，落 Reviews/ 周
		// 文件（同周覆盖）。提示词取设置覆盖，否则用插件内置默认。
		this.addCommand({
			id: "generate-weekly-review",
			name: "生成 AI 周回顾",
			callback: () => {
				void this.runWeeklyReview();
			},
		});

		// 启动即主页（票 09）：布局就绪后自动打开 Home 视图，设置可关。
		// 替代 Homepage 插件，不依赖外部插件。
		this.app.workspace.onLayoutReady(() => {
			if (shouldOpenOnStartup(this.settings)) {
				void this.activateView();
			}
		});
	}

	/** 一键周回顾：命令面板与 Home 卡片共用这一条路径。 */
	async runWeeklyReview(): Promise<string | null> {
		const c = resolveConventions(this.settings);
		return generateWeeklyReview(this.app, Date.now(), {
			weekLabel: () => window.moment().format("GGGG-[W]WW"),
			nowLabel: () => window.moment().format("YYYY-MM-DD HH:mm"),
			noteDate: (ctime) => window.moment(ctime).format("MM-DD HH:mm"),
		}, {
			requestUrl,
			ai: {
				apiUrl: this.settings.apiUrl,
				apiKey: this.settings.apiKey,
				model: this.settings.aiModel,
			},
			prompt: this.settings.reviewPrompt.trim() || DEFAULT_REVIEW_PROMPT,
			inboxDir: c.inboxDir,
			reviewsDir: c.reviewsDir,
			notice: (msg) => new Notice(msg),
		});
	}

	onunload(): void {
		// 干净卸载（票 09）：显式关掉本插件的视图 leaf（不依赖 Obsidian 的
		// 自动 detach），并兜底清掉 body 级 class——view 的 destroy 正常走
		// garden-dom 的摘除，这里防的是非正常路径（如禁用插件时视图仍开着）。
		// 生成的文件（Home 入口、Inbox 数据）有意保留，不做任何删除。
		for (const type of [HOME_VIEW_TYPE, LONGFORM_VIEW_TYPE]) {
			for (const leaf of this.app.workspace.getLeavesOfType(type)) {
				leaf.detach();
			}
		}
		for (const cls of BODY_CLEANUP_CLASSES) {
			document.body.classList.remove(cls);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
		this.addSettingTab(new HomeDashboardSettingTab(this.app, this));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Focus the existing Home leaf, or open a new one in a fresh tab. */
	private async activateView(): Promise<void> {
		const { workspace } = this.app;
		const leaf = chooseLeaf(
			workspace.getLeavesOfType(HOME_VIEW_TYPE),
			() => workspace.getLeaf(true),
		);
		if (!leaf) return;
		await leaf.setViewState({ type: HOME_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}
}
