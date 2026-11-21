/**
 * Weekly review (AI 周回顾, 票 08): collect the trailing 7 days of Inbox
 * quick notes, add local stats, ask the AI for observations & suggestions,
 * and write the review note into the reviews directory (same ISO week
 * overwrites). The digest/stats half is the pure core (weekly-review-core);
 * this module is the runtime shell — vault + metadataCache + moment +
 * requestUrl are injected, so the Obsidian command and any future card go
 * through one code path. Port of Scripts/weekly-review.js; its _config.json
 * read disappears (settings page owns the key) and its Prompts/ read
 * disappears (prompts ship with the plugin, settings can override).
 */
import { buildWeekReview, type WeekNote } from "./weekly-review-core";
import { callAIText, type AIConfig, type RequestUrlLike } from "./ai";
import { collectInbox, snapshotVault, type FileCacheLike } from "./inbox-query";

/** Minimal TFile slice: ctime/mtime live at stat.* in the real Obsidian API. */
export interface ReviewFile {
	path: string;
	basename: string;
	stat: { ctime: number; mtime: number };
}

/** The slice of the Obsidian App the weekly review touches. */
export interface WeeklyReviewApp {
	vault: {
		getMarkdownFiles(): ReviewFile[];
		cachedRead(file: ReviewFile): Promise<string>;
		getAbstractFileByPath(path: string): { path: string } | null;
		create(path: string, data: string): Promise<unknown>;
		modify(file: { path: string }, data: string): Promise<unknown>;
		adapter: {
			exists(path: string): Promise<boolean>;
			mkdir(dir: string): Promise<void>;
		};
	};
	metadataCache: {
		getFileCache(file: ReviewFile): FileCacheLike | null;
	};
}

/** Injected clock/format layer (moment lives in the Obsidian runtime). */
export interface WeeklyReviewFormatters {
	/** ISO week label, e.g. 2026-W44. */
	weekLabel(): string;
	/** Generation timestamp, e.g. 2026-11-18 12:00. */
	nowLabel(): string;
	/** Per-note stamp, e.g. 11-17 09:00. */
	noteDate(ctime: number): string;
}

export interface WeeklyReviewOpts {
	requestUrl: RequestUrlLike;
	ai: AIConfig;
	/** Review prompt (settings override already folded in by the caller). */
	prompt: string;
	inboxDir: string;
	reviewsDir: string;
	notice: (msg: string) => void;
}

const fmStr = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * One-stop weekly review. Returns the written review path, or null when
 * nothing was generated (empty window, missing key, AI or write failure —
 * reason already reported via `notice`).
 */
export async function generateWeeklyReview(
	app: WeeklyReviewApp,
	nowMs: number,
	fmt: WeeklyReviewFormatters,
	opts: WeeklyReviewOpts,
): Promise<string | null> {
	const notice = opts.notice;

	// 近 7 天 Inbox 随手记 → WeekNote 快照（草稿/日历文件已由 collectInbox 排除）。
	// 保留真实 TFile 引用：cachedRead/getFileCache 都要吃真文件，不能拿 {path} 桩
	const files = app.vault.getMarkdownFiles();
	const byPath = new Map(files.map((f) => [f.path, f]));
	const pages = collectInbox(
		snapshotVault(files, (f) => app.metadataCache.getFileCache(f)),
		opts.inboxDir,
	);
	const notes: WeekNote[] = [];
	for (const page of pages) {
		const file = byPath.get(page.path);
		if (!file) continue;
		let body = await app.vault.cachedRead(file);
		body = body.replace(/^---[\s\S]*?---/, "").trim();
		const fm = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		notes.push({
			ctime: page.ctime,
			date: fmt.noteDate(page.ctime),
			category: [fm.category, fm.subcategory, fm.subsubcategory]
				.map(fmStr)
				.filter(Boolean)
				.join(">"),
			summary: page.summary || body.slice(0, 30),
			status: fmStr(fm.status),
			body,
		});
	}

	const week = buildWeekReview(notes, nowMs);
	if (!week) {
		notice("近 7 天 Inbox 没有记录，无可回顾");
		return null;
	}

	notice(`🔄 正在生成周回顾（${week.stats.count} 条记录）...`);
	const ai = await callAIText(opts.requestUrl, opts.ai, {
		system: opts.prompt,
		user: `本周随手记共 ${week.stats.count} 条，活跃 ${week.stats.activeDays} 天，新增待办 ${week.stats.pending} 条：\n\n${week.digest}`,
		notice,
	});
	if (!ai) return null;

	// Reviews/2026-W44.md（ISO 周，同周覆盖）
	const weekLabel = fmt.weekLabel();
	const dir = opts.reviewsDir;
	if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir);
	const path = `${dir}/${weekLabel}.md`;
	const content =
		`---\ntype: review\nweek: ${weekLabel}\ngenerated: ${fmt.nowLabel()}\n---\n` +
		`# 📚 ${weekLabel} 周回顾\n\n## 🔢 本周数字\n\n` +
		`- 记录 **${week.stats.count}** 条，活跃 **${week.stats.activeDays}** 天\n` +
		`- 新增待办 **${week.stats.pending}** 条\n\n${ai}\n`;

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing) await app.vault.modify(existing, content);
	else await app.vault.create(path, content);
	notice(`✅ 周回顾已生成：${path}`);
	return path;
}
