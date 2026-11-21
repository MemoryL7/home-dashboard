/**
 * UI-side glue of the longform draft feature: derives deps from plugin
 * settings and runs create/promote/query. (lib/longform-core.ts stays
 * obsidian-free; Notice/requestUrl/TFile enter here.)
 */
import { Notice, requestUrl, type TFile } from "obsidian";
import type HomeDashboardPlugin from "../main";
import { draftFilePath, draftFrontmatter, collectDrafts, type DraftPage } from "./longform-core";
import { snapshotVault } from "./inbox-query";
import { resolveConventions } from "./conventions";
import { DEFAULT_CLASSIFY_PROMPT } from "./prompts";
import { classify } from "./classify-core";

/** 新建草稿：Inbox 内建 status: draft 的文件（撞名自动加时间戳）。 */
export async function createLongformDraft(plugin: HomeDashboardPlugin, title: string): Promise<TFile> {
	const conventions = resolveConventions(plugin.settings);
	const inboxDir = conventions.inboxDir;
	const existing = plugin.app.vault
		.getMarkdownFiles()
		.filter((f) => f.path.startsWith(inboxDir + "/"))
		.map((f) => f.path);
	const path = draftFilePath(inboxDir, title, Date.now(), existing);
	if (!(await plugin.app.vault.adapter.exists(inboxDir))) {
		await plugin.app.vault.adapter.mkdir(inboxDir);
	}
	return plugin.app.vault.create(path, draftFrontmatter());
}

/** 草稿清单：真实 vault + metadataCache → snapshotVault → collectDrafts（薄壳）。 */
export function listDrafts(plugin: HomeDashboardPlugin): DraftPage[] {
	const conventions = resolveConventions(plugin.settings);
	return collectDrafts(
		snapshotVault(plugin.app.vault.getMarkdownFiles(), (f) =>
			plugin.app.metadataCache.getFileCache(f),
		),
		conventions.inboxDir,
	);
}

/**
 * 一键归类转正（票 07 验收项）：classify-core 全链路——frontmatter
 * 写入 + 总索引更新 + 移出草稿态（clearStatus: true，ADR 0002）。
 * 返回 true=转正成功。
 */
export async function runPromote(plugin: HomeDashboardPlugin, file: TFile): Promise<boolean> {
	const conventions = resolveConventions(plugin.settings);
	return classify(plugin.app, requestUrl, file, {
		ai: {
			apiUrl: plugin.settings.apiUrl,
			apiKey: plugin.settings.apiKey,
			model: plugin.settings.aiModel,
		},
		prompt: plugin.settings.classifyPrompt.trim() || DEFAULT_CLASSIFY_PROMPT,
		indexDir: conventions.indexDir,
		clearStatus: true,
		notice: (m) => new Notice(m),
	});
}
