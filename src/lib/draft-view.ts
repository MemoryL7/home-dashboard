/* ============================================================
   draft-view —— 📝 草稿箱卡片渲染（票 07）
   自 Home.md 的 draftCard/renderDrafts 迁入：新建长文（标题弹窗）、
   继续写作（点草稿名重入会话级编辑器）、删除。长文草稿不进统计
   （inbox-query 已排除 status: draft），草稿箱是唯一重入点（ADR 0002）。
   ============================================================ */
import { type App, type TFile } from "obsidian";
import type HomeDashboardPlugin from "../main";
import { listDrafts } from "./draft-ui";
import { LongformTitleModal, openLongformEditor } from "./longform-view";
import { putIcon, ICON_TITLE, ICON_BTN } from "./icon";
import type { DraftPage } from "./longform-core";
import type { MomentLike } from "./stats-view";

export interface DraftCardDeps {
	app: App;
	plugin: HomeDashboardPlugin;
	moment: MomentLike;
	notice: (msg: string) => void;
	/** 草稿变化（新建/删除/转正）后的回调（Home 视图刷新统计）。 */
	onChanged?: () => void;
}

export interface DraftCard {
	/** 重查库并重绘草稿列表（无状态，可随意频次调用）。 */
	refresh(): void;
}

/** 纯 DOM 组装：parent 需已带 .home-dashboard.home-v2 根类。 */
export function renderDraftCard(parent: HTMLElement, deps: DraftCardDeps): DraftCard {
	const cardEl = parent.createDiv({ cls: "dash-card card-bamboo draft-card" });
	const head = cardEl.createDiv({ cls: "draft-head" });
	const h3 = head.createEl("h3");
	putIcon(h3, "file-text", ICON_TITLE);
	h3.createSpan({ text: "草稿箱" });
	head.createEl("button", {
		cls: "card-act",
		attr: { "data-tip": "新增长文笔记，进入草稿箱" },
	}, (btn) => {
		putIcon(btn, "file", ICON_BTN);
		btn.createSpan({ text: " 新增长文" });
	}).addEventListener("click", () => {
		new LongformTitleModal(deps.plugin).open();
	});
	const body = cardEl.createDiv({ cls: "draft-body" });

	const refresh = (): void => {
		body.empty();
		const drafts = listDrafts(deps.plugin);
		if (!drafts.length) {
			body.createDiv({ cls: "mini-muted", text: "没有进行中的草稿" });
			return;
		}
		for (const d of drafts) {
			const row = body.createDiv({ cls: "draft-row" });
			const main = row.createDiv({ cls: "draft-main" });
			main.createEl("a", {
				cls: "draft-link internal-link",
				text: d.basename,
				attr: { href: d.path },
			}).addEventListener("click", (ev) => {
				ev.preventDefault();
				openDraft(d.path);
			});
			main.createEl("span", {
				text: `  ${deps.moment(d.mtime).format("MM-DD")}`,
				cls: "mini-muted",
			});
			row.createEl("button", {
				cls: "draft-del",
				attr: { "data-tip": "删除草稿（移入回收站）" },
			}, (btn) => putIcon(btn, "x", ICON_BTN)).addEventListener("click", () => void remove(d));
		}
	};

	const openDraft = (path: string): void => {
		const file = deps.app.vault.getAbstractFileByPath(path) as TFile | null;
		if (!file) {
			deps.notice("❌ 草稿文件不存在");
			refresh();
			return;
		}
		openLongformEditor(deps.plugin, file);
	};

	const remove = async (d: DraftPage): Promise<void> => {
		const file = deps.app.vault.getAbstractFileByPath(d.path) as TFile | null;
		if (!file) return;
		await deps.app.vault.trash(file, true);
		deps.notice("🗑 草稿已删除");
		refresh();
		deps.onChanged?.();
	};

	refresh();
	return { refresh };
}
