/* ============================================================
   note-create —— Inbox 落盘公共件：frontmatter + 正文 → 新笔记。
   原 todo-view 私有 createNote，详情弹窗要复用同款落盘（跟进记录），
   2026-11 抽出。数组值展开为 yaml 列表（- 前缀两空格缩进）。
   ============================================================ */

/** vault/文件管理的最小切片（与 todo-view 的 TodoAppLike 同形子集）。 */
export interface NoteCreateAppLike {
	vault: {
		create(path: string, data: string): Promise<unknown>;
		adapter: {
			exists(path: string): Promise<boolean>;
			mkdir(path: string): Promise<void>;
		};
	};
}

/** 落一条 Inbox 笔记，返回目标路径（调用方负责后续 classify/waitFor）。 */
export async function createInboxNote(
	app: NoteCreateAppLike,
	inboxDir: string,
	stamp: string,
	meta: Record<string, unknown>,
	body: string,
): Promise<string> {
	const path = `${inboxDir}/${stamp}.md`;
	if (!(await app.vault.adapter.exists(inboxDir))) {
		await app.vault.adapter.mkdir(inboxDir);
	}
	const lines = Object.entries(meta)
		.map(([k, v]) =>
			Array.isArray(v)
				? `${k}:\n${v.map((t) => `  - ${t}`).join("\n")}`
				: `${k}: ${v}`,
		)
		.join("\n");
	await app.vault.create(path, `---\n${lines}\n---\n${body}\n`);
	return path;
}
