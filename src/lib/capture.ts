/**
 * Quick capture (随手记): turn a snippet of raw text into a timestamped note
 * in the Inbox, then AI-classify it. The file creation is a pure-ish core
 * (clock injected); the classify orchestration injects everything so both the
 * Home card and the command palette go through one code path.
 */
import { classify, type ClassifyApp, type TFileLike } from "./classify-core";
import { callAI, type AIConfig, type RequestUrlLike } from "./ai";

/** The slice of the Obsidian vault capture touches. */
export interface VaultLike {
	read(file: TFileLike): Promise<string>;
	adapter: {
		exists(path: string): Promise<boolean>;
		mkdir(dir: string): Promise<void>;
	};
	create(path: string, data: string): Promise<TFileLike>;
}

/** PadStart-based local timestamp: YYYY-MM-DD-HHmmss. */
export function captureStamp(now: Date): string {
	const p = (n: number, w = 2): string => String(n).padStart(w, "0");
	return (
		`${p(now.getFullYear(), 4)}-${p(now.getMonth() + 1)}-${p(now.getDate())}` +
		`-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
	);
}

/** Frontmatter lines for a fresh capture: empty classification slots. */
export function captureFrontmatter(summary: string, tags: string[]): string {
	// Summary is quoted: raw text may contain ':' or '#' and break the YAML.
	const lines = [
		`category: ''`,
		`subcategory: ''`,
		`subsubcategory: ''`,
		`summary: "${summary.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
		`tags:`,
		...tags.map((t) => `  - ${t}`),
		`status: ''`,
	];
	return `---\n${lines.join("\n")}\n---\n`;
}

/** Raw-text summary: collapsed whitespace, at most 30 chars. */
export function captureSummary(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, 30);
}

/**
 * Create the Inbox note for a quick capture and return its file handle.
 * `now` is injected for tests; production passes `new Date()`.
 */
export async function createQuickNote(
	vault: VaultLike,
	conventions: { inboxDir: string },
	text: string,
	now: Date = new Date(),
): Promise<TFileLike> {
	const path = `${conventions.inboxDir}/${captureStamp(now)}.md`;
	if (!(await vault.adapter.exists(conventions.inboxDir))) {
		await vault.adapter.mkdir(conventions.inboxDir);
	}
	return vault.create(path, `${captureFrontmatter(captureSummary(text), [])}${text}\n`);
}

export interface CaptureDeps {
	requestUrl: RequestUrlLike;
	ai: AIConfig;
	prompt: string;
	inboxDir: string;
	indexDir: string;
	notice: (msg: string) => void;
	/** Hook after a successful capture (e.g. dashboard re-render). */
	onClassified?: () => void;
}

/**
 * One-stop quick capture: save to Inbox → AI classify → (caller reloads UI).
 * Returns true when the full pipeline succeeded.
 */
/** Everything one capture touches: classify's slice + note creation. */
export type CaptureApp = ClassifyApp & { vault: VaultLike };

export async function captureAndClassify(
	app: CaptureApp,
	text: string,
	deps: CaptureDeps,
): Promise<boolean> {
	const trimmed = text.trim();
	if (!trimmed) {
		deps.notice("先写点什么再归类 🎋");
		return false;
	}
	const file = await createQuickNote(app.vault, { inboxDir: deps.inboxDir }, trimmed).catch(
		(e: Error) => {
			deps.notice(`❌ 保存失败: ${e.message}`);
			return null;
		},
	);
	if (!file) return false;
	deps.notice("🔄 已保存，AI 归类中…");
	const ok = await classify(app, deps.requestUrl, file, {
		ai: deps.ai,
		prompt: deps.prompt,
		indexDir: deps.indexDir,
		clearStatus: false,
		notice: deps.notice,
	});
	if (ok) deps.onClassified?.();
	return ok;
}
