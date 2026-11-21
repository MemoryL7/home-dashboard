/* ============================================================
   classify-core —— 归类 (Classification) 深模块
   AI 调用 → JSON 解析 → frontmatter 写入 → 索引更新，全部实
   现藏在一个 classify() 后面。自 Scripts/classify-core.js 迁入
   （ADR 0004），签名不变；变化仅在依赖注入：
   - 配置不再读 _config.json，AI 连接由 opts.ai 注入（插件设置）
   - 提示词不再读 Prompts/，由 opts.prompt 注入（内置默认/设置覆盖）
   - 索引目录由 opts.indexDir 注入（路径约定）
   interface：classify(app, requestUrl, file, opts)
     opts.clearStatus  true = 归类后 status 清空（ADR 0002：长文草稿转正）
                       false = 仅在 AI 返回 status 时写入（保留 draft）
     opts.notice(msg)  提示回调；调用方注入
   返回 true=归类成功 / false=失败
   ============================================================ */
import { callAI, type AIConfig, type RequestUrlLike } from "./ai";

/** The slice of an Obsidian TFile the core touches. */
export interface TFileLike {
	path: string;
	name: string;
}

/** The slice of the Obsidian App the core touches (Node-testable). */
export interface ClassifyApp {
	vault: {
		read(file: TFileLike): Promise<string>;
		adapter: {
			exists(path: string): Promise<boolean>;
			read(path: string): Promise<string>;
			write(path: string, data: string): Promise<void>;
			mkdir(dir: string): Promise<void>;
		};
	};
	fileManager: {
		processFrontMatter(
			file: TFileLike,
			fn: (fm: Record<string, unknown>) => unknown,
		): Promise<void>;
	};
}

/**
 * 本地时区的 24H 时间戳（YYYY-MM-DD HH:mm:ss）。classified 字段用。
 * toISOString() 固定输出 UTC，先按 timezoneOffset 平移再截取，避免差时区。
 */
export function localStamp(now: Date = new Date()): string {
	return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");
}

export interface ClassifyOpts {
	ai: AIConfig;
	prompt: string;
	indexDir: string;
	clearStatus?: boolean;
	notice?: (msg: string) => void;
}

export async function classify(
	app: ClassifyApp,
	requestUrl: RequestUrlLike,
	file: TFileLike,
	opts: ClassifyOpts,
): Promise<boolean> {
	const o = { clearStatus: false, notice: () => {}, ...opts };
	try {
		return await runClassify(app, requestUrl, file, o);
	} catch (e) {
		o.notice(`❌ 归类错误: ${(e as Error).message}`);
		return false;
	}
}

async function runClassify(
	app: ClassifyApp,
	requestUrl: RequestUrlLike,
	file: TFileLike,
	o: Required<Pick<ClassifyOpts, "clearStatus" | "notice">> & ClassifyOpts,
): Promise<boolean> {
	const adapter = app.vault.adapter;

	const content = await app.vault.read(file);
	const result = await callAI(requestUrl, o.ai, {
		system: o.prompt,
		user: content,
		notice: o.notice,
	});
	if (!result) return false;

	const cat = String(result.category ?? "未分类");
	const subcat = String(result.subcategory ?? "");
	const subsubcat = String(result.subsubcategory ?? "");
	const summary = String(result.summary ?? "");
	const tags = Array.isArray(result.tags) ? result.tags : [];

	// Frontmatter: classification fields + classification timestamp.
	await app.fileManager.processFrontMatter(file, (fm: any) => {
		fm.category = cat;
		fm.subcategory = subcat;
		fm.subsubcategory = subsubcat;
		fm.summary = summary;
		fm.tags = tags;
		fm.status = result.status
			? result.status
			: o.clearStatus
				? ""
				: (fm.status ?? "");
		fm.classified = localStamp();
	});

	// Index pages: top-level counts → level-2 → level-3 → detail table.
	const ensureDir = async (d: string): Promise<void> => {
		if (!(await adapter.exists(d))) await adapter.mkdir(d);
	};
	const readFile = async (p: string): Promise<string> =>
		(await adapter.exists(p)) ? await adapter.read(p) : "";
	const dateStr = file.name.slice(0, 10);
	const statusStr = String(result.status ?? "") || "-";
	const link = `[[${file.path}]]`;
	await ensureDir(o.indexDir);
	const topPath = `${o.indexDir}/00-top.md`;
	let top = await readFile(topPath);
	const esc = cat.replace(/[.*+?${}()|[\]\\]/g, "\\$&");
	if (!top.includes(`## ${cat} `)) {
		top = top.trimEnd() + `\n## ${cat} (1条)\n→ [[${cat}|进入]]\n`;
	} else {
		top = top.replace(
			new RegExp(`(## ${esc} \\()+(\\d+)(条\\))`),
			(_m, p: string, c: string, s: string) => p + (parseInt(c) + 1) + s,
		);
	}
	await adapter.write(topPath, top);
	if (subcat) {
		const l2Path = `${o.indexDir}/${cat}.md`;
		let l2 = await readFile(l2Path);
		const l2Entry = subsubcat
			? `### ${subcat}\n→ [[${cat}-${subcat}|进入]]`
			: `### ${subcat}`;
		if (!l2.includes(`### ${subcat}`)) l2 = l2.trimEnd() + `\n${l2Entry}\n`;
		await adapter.write(l2Path, l2);
		let tblPath: string;
		let tblTitle: string;
		if (subsubcat) {
			const l3Path = `${o.indexDir}/${cat}-${subcat}.md`;
			let l3 = await readFile(l3Path);
			if (!l3.includes(`#### ${subsubcat}`)) {
				l3 =
					l3.trimEnd() +
					`\n#### ${subsubcat}\n→ [[${cat}-${subcat}-${subsubcat}|进入]]\n`;
			}
			await adapter.write(l3Path, l3);
			tblPath = `${o.indexDir}/${cat}-${subcat}-${subsubcat}.md`;
			tblTitle = `${cat} > ${subcat} > ${subsubcat}`;
		} else {
			tblPath = `${o.indexDir}/${cat}-${subcat}.md`;
			tblTitle = `${cat} > ${subcat}`;
		}
		let tbl = await readFile(tblPath);
		const line = `| ${dateStr} | ${summary} | ${statusStr} | ${link} |`;
		if (!tbl.includes("| --- |")) {
			tbl = `# ${tblTitle}\n\n| 时间 | 摘要 | 状态 | 笔记 |\n| --- | --- | --- | --- |\n${line}\n`;
		} else {
			tbl = tbl.trimEnd() + "\n" + line + "\n";
		}
		await adapter.write(tblPath, tbl);
	}
	o.notice(
		`✅ 归类完成: ${cat}${subcat ? " > " + subcat : ""}${subsubcat ? " > " + subsubcat : ""}`,
	);
	return true;
}
