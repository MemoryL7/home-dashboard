/* ============================================================
   inbox-query —— 库内随手记查询（vault API + metadataCache 自实现，
   不依赖 Dataview；票 04）。纯函数 collectInbox 只吃 (文件+缓存)
   快照，Node 可测；快照构建薄壳 snapshotVault 也在此（统计/最近/
   草稿箱/周回顾共用一个 adapter，不再各自手搓）。
   口径与 Home.md 的 loadInbox 一致：
   - 仅 Inbox 目录下的 md（目录由路径约定注入）
   - frontmatter.type === 'daylog' 的文件不计
   - status === 'draft' 的长文草稿不计（写作进行中，只在草稿箱出现；
     与票 07 约定对齐：草稿不进统计与热力）
   ============================================================ */

/** metadataCache 文件缓存中用到的切片。 */
export interface FileCacheLike {
	frontmatter?: Record<string, unknown> | null;
}

/** vault.getMarkdownFiles() 条目 + 其文件缓存的合并快照。 */
export interface VaultFileSnapshot {
	path: string;
	basename: string;
	ctime: number;
	/** 修改时刻（ms）——collectDrafts（草稿箱）要用；collectInbox 不消费。 */
	mtime: number;
	cache: FileCacheLike;
}

/**
 * 运行时薄壳：真实 vault.getMarkdownFiles() + metadataCache → 快照。
 * 这是纯函数（collectInbox / collectDrafts / 统计）与 Obsidian 之间
 * 唯一的对接点——统计、最近新增、草稿箱、周回顾共用同一个快照构建，
 * 不再各自手搓 map-to-snapshot（2026-11 自 stats-view 迁入）。
 */
export function snapshotVault<
	F extends { path: string; basename: string; stat: { ctime: number; mtime: number } },
>(
	vaultFiles: F[],
	getCache: (f: F) => FileCacheLike | null,
): VaultFileSnapshot[] {
	return vaultFiles.map((f) => ({
		path: f.path,
		basename: f.basename,
		ctime: f.stat.ctime,
		mtime: f.stat.mtime,
		cache: getCache(f) ?? {},
	}));
}

/** 统计/卡片消费的一条随手记页面。 */
export interface InboxPage {
	path: string;
	name: string;
	ctime: number;
	summary: string;
	category: string;
	/** 中类：大类下的自然子划分；待办条目以它作领域归行（ADR 0007）。 */
	subcategory: string;
	status: string;
	/** 待办精力分面：deep / shallow；非待办或未分为空串。 */
	energy: string;
	/** 待办紧迫度分面：now / soon / someday；非待办或未分为空串。 */
	urgency: string;
	tags: string[];
	related: unknown;
	/** 完成时刻（ms）。fm.completed（localStamp 格式）解析而来；无/解析失败为 0。 */
	completed: number;
}

/**
 * 纯：fm.completed（localStamp 的 "YYYY-MM-DD HH:mm:ss" 本地时间）→ ms。
 * 手动按字段解析（Date.parse 对空格分隔的日期串行为因实现而异）；
 * 缺失或非法返回 0，调用方以此判断"无完成时间"。
 */
export function completedTs(v: unknown): number {
	if (typeof v !== "string") return 0;
	const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
	if (!m) return 0;
	const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
	return new Date(y, mo - 1, d, h, mi, s).getTime();
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * 纯：vault 文件快照 → 统计页面列表。顺序沿用输入顺序（最近排序
 * 由调用方按 ctime 做），不做隐藏排序。
 */
export function collectInbox(files: VaultFileSnapshot[], inboxDir: string): InboxPage[] {
	const out: InboxPage[] = [];
	for (const f of files) {
		if (!f.path.startsWith(inboxDir + "/")) continue;
		const fm = f.cache?.frontmatter || {};
		if (fm.type === "daylog") continue;
		// 草稿（status: draft）写作进行中，不进任何统计，只在草稿箱出现
		if (fm.status === "draft") continue;
		out.push({
			path: f.path,
			name: f.basename,
			ctime: f.ctime,
			summary: str(fm.summary),
			category: str(fm.category),
			subcategory: str(fm.subcategory),
			status: str(fm.status),
			energy: str(fm.energy),
			urgency: str(fm.urgency),
			tags: Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === "string") : [],
			related: fm.related,
			completed: completedTs(fm.completed),
		});
	}
	return out;
}
