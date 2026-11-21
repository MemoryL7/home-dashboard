/* ============================================================
   longform-core —— 长文草稿纯函数（票 07）
   草稿的文件名（标题清洗 + 撞名兜底）、初始 frontmatter、草稿清单
   查询三件纯函数，Node 可测；Obsidian 侧的 Modal 编辑器与 Home 草稿
   箱卡片是薄壳（ADR 0002 会话级语义不变）：
   - 编辑器为会话级 Modal，文件实时落盘，关开不丢内容；
   - 草稿 status: draft，不进统计与热力（inbox-query 排除），
     只在草稿箱出现；草稿箱是唯一重入点；
   - 归类转正走 classify-core（clearStatus: true：转正后 status
     清空，与既有「非待办记录 status 留空」约定一致）。
   ============================================================ */

/** metadataCache 文件缓存切片（与 inbox-query 同形）。 */
export interface FileCacheLike {
	frontmatter?: Record<string, unknown> | null;
}

/** 草稿箱清单消费的一条快照（vault.getMarkdownFiles() + 缓存）。 */
export interface DraftSnapshot {
	path: string;
	basename: string;
	mtime: number;
	cache: FileCacheLike;
}

/** 草稿箱卡片/编辑器用到的一条草稿。 */
export interface DraftPage {
	path: string;
	basename: string;
	mtime: number;
}

/* —— Markdown 格式化（工具栏动作，纯函数；自旧版编辑器工具栏重建） —— */

/** 工具栏动作：包裹类（加粗/斜体/行内代码）与前缀类（标题/列表/引用/链接）。 */
export type MdAction = "bold" | "italic" | "code" | "heading" | "list" | "quote" | "link";

/** applyMdAction 的返回：新文本与新的选区（光标落点）。 */
export interface MdResult {
	text: string;
	start: number;
	end: number;
}

const WRAP: Partial<Record<MdAction, { m: string; ph: string }>> = {
	bold: { m: "**", ph: "加粗文字" },
	italic: { m: "*", ph: "斜体文字" },
	code: { m: "`", ph: "代码" },
};

/**
 * 纯：对 [start,end) 选区应用一个 Markdown 动作，返回新文本与选区。
 * 包裹类：选中即包裹；再对已包裹的选区执行则解开（toggle）。
 * 前缀类（heading/list/quote）：对选区涉及的每行行首加/去前缀。
 * link：选区文本变 `[选区](链接地址)`，选区落在 URL 上。
 */
export function applyMdAction(text: string, start: number, end: number, action: MdAction): MdResult {
	if (action === "link") {
		const sel = text.slice(start, end) || "链接文字";
		const before = text.slice(0, start);
		const after = text.slice(end);
		const mid = `[${sel}](链接地址)`;
		return { text: before + mid + after, start: start + sel.length + 3, end: start + mid.length - 1 };
	}
	if (action === "heading" || action === "list" || action === "quote") {
		const prefix = action === "heading" ? "## " : action === "list" ? "- " : "> ";
		const ls = text.lastIndexOf("\n", start - 1) + 1; // 选区首行行首
		let le = text.indexOf("\n", end); // 选区末行行尾（不含换行）
		if (le === -1) le = text.length;
		const lines = text.slice(ls, le).split("\n");
		const all = lines.every((l) => l.startsWith(prefix));
		const out = lines
			.map((l) => (all ? l.slice(prefix.length) : prefix + l))
			.join("\n");
		return { text: text.slice(0, ls) + out + text.slice(le), start: ls, end: ls + out.length };
	}
	const w = WRAP[action];
	if (!w) return { text, start, end };
	const sel = text.slice(start, end);
	const before = text.slice(0, start);
	const after = text.slice(end);
	// toggle：选区两端已是包裹符则解开
	if (
		sel.length >= w.m.length * 2 &&
		sel.startsWith(w.m) &&
		sel.endsWith(w.m)
	) {
		const inner = sel.slice(w.m.length, sel.length - w.m.length);
		return {
			text: before + inner + after,
			start,
			end: start + inner.length,
		};
	}
	const body = sel || w.ph;
	return {
		text: before + w.m + body + w.m + after,
		start: start + w.m.length,
		end: start + w.m.length + body.length,
	};
}

/**
 * 纯：拆出文件头部的 YAML frontmatter（含围栏），返回 [frontmatter, 正文]。
 * 编辑器的 textarea 只吃正文：frontmatter 由 classify-core 写，不该被
 * 手改——否则误删 status: draft 一行，草稿会从草稿箱消失还混进统计。
 */
export function splitFrontmatter(content: string): [string, string] {
	const m = content.match(/^---\n[\s\S]*?\n---\n/);
	if (!m) return ["", content];
	return [m[0], content.slice(m[0].length)];
}

/**
 * 纯：标题 → Inbox 内的草稿文件路径。清洗掉 Obsidian 文件名非法
 * 字符；全无效时落到「未命名」；与现有文件撞名时追加本地时间戳
 * （now 为注入的 epoch 毫秒，生产传 Date.now()）。
 */
export function draftFilePath(inboxDir: string, title: string, now: number, existing: string[]): string {
	const safe = title
		.replace(/[\\/:#^[\]|*?"<>]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const base = safe.length > 0 ? safe : "未命名";
	let name = `${base}.md`;
	if (existing.includes(`${inboxDir}/${name}`)) {
		const d = new Date(now);
		const p = (n: number, w = 2): string => String(n).padStart(w, "0");
		const stamp =
			`${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
			`-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
		name = `${base}-${stamp}.md`;
	}
	return `${inboxDir}/${name}`;
}

/** 草稿初始 frontmatter：归类槽位留空，status: draft（ADR 0002）。 */
export function draftFrontmatter(): string {
	return [
		"---",
		"category: ''",
		"subcategory: ''",
		"subsubcategory: ''",
		'summary: ""',
		"tags:",
		"status: draft",
		"---",
		"",
	].join("\n");
}

/**
 * 纯：vault 文件快照 → 草稿清单（mtime 倒序）。口径与统计互补：
 * Inbox 目录内、status: draft 的 md 才是草稿（daylog 即使误标
 * draft 也不算——它不是长文）。
 */
export function collectDrafts(files: DraftSnapshot[], inboxDir: string): DraftPage[] {
	const out: DraftPage[] = [];
	for (const f of files) {
		if (!f.path.startsWith(inboxDir + "/")) continue;
		const fm = f.cache?.frontmatter || {};
		if (fm.type === "daylog") continue;
		if (fm.status !== "draft") continue;
		out.push({ path: f.path, basename: f.basename, mtime: f.mtime });
	}
	return out.sort((a, b) => b.mtime - a.mtime);
}
