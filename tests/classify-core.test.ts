import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, localStamp } from "../src/lib/classify-core";
import type { TFileLike } from "../src/lib/classify-core";

/**
 * Fake app with an in-memory adapter + frontmatter support, mirroring the
 * "fake app injection" seam the classify deep module has been tested through
 * since Scripts/classify-core.js (ADR 0004).
 */
function fakeApp(initialFiles: Record<string, string> = {}): {
	app: any;
	files: Record<string, string>;
} {
	const files: Record<string, string> = { ...initialFiles };
	const write = async (path: string, body: string): Promise<void> => {
		files[path] = body;
	};
	const app = {
		vault: {
			adapter: {
				exists: async (p: string) => p in files,
				read: async (p: string) => {
					if (!(p in files)) throw new Error(`not found: ${p}`);
					return files[p];
				},
				write,
				mkdir: async (_d: string) => {},
			},
			read: async (file: TFileLike) => {
				if (!(file.path in files)) throw new Error(`not found: ${file.path}`);
				return files[file.path];
			},
		},
		fileManager: {
			processFrontMatter: async (
				file: TFileLike,
				fn: (fm: Record<string, unknown>) => void,
			) => {
				const body = files[file.path] ?? "";
				const m = body.match(/^---\n([\s\S]*?)\n---\n?/);
				const fm: Record<string, unknown> = {};
				if (m) {
					for (const line of m[1].split("\n")) {
						const kv = line.match(/^(\w[\w-]*): (.*)$/);
						if (kv) fm[kv[1]] = kv[2];
					}
				}
				fn(fm);
				const rest = m ? body.slice(m[0].length) : body;
				const yaml = Object.entries(fm)
					.map(([k, v]) =>
						Array.isArray(v)
							? `${k}:\n${v.map((t) => `  - ${t}`).join("\n")}`
							: `${k}: ${v}`,
					)
					.join("\n");
				files[file.path] =
					Object.keys(fm).length > 0 ? `---\n${yaml}\n---\n${rest}` : rest;
			},
		},
	};
	return { app, files };
}

const AI = {
	apiUrl: "https://api.example.test/v1/chat/completions",
	apiKey: "sk-test",
	model: "test-model",
};

const PROMPT = "你是笔记分类助手";

/** Fake requestUrl that echoes a canned AI answer and records the request. */
function fakeRequestUrl(answer: object | string, status = 200) {
	const calls: any[] = [];
	const requestUrl = async (opts: any) => {
		calls.push(opts);
		const raw =
			typeof answer === "string"
				? answer
				: JSON.stringify(answer, null, 2);
		return {
			status,
			text: raw,
			json:
				status < 400
					? { choices: [{ message: { content: raw } }] }
					: undefined,
		};
	};
	return { requestUrl, calls };
}

const NOTE: TFileLike = { path: "Inbox/2026-11-18-101010.md", name: "2026-11-18-101010.md" };
const BASE_FILES = { [NOTE.path]: "---\nstatus: pending\n---\n买一棵竹子\n" };

const classifyResult = {
	category: "生活",
	subcategory: "购物",
	subsubcategory: "",
	summary: "买一棵竹子",
	tags: ["竹子", "购物"],
	status: "",
};

function opts(extra: Record<string, unknown> = {}) {
	return { ai: AI, prompt: PROMPT, indexDir: "_Index", ...extra };
}

void test("classify calls the AI with settings config + prompt and writes frontmatter", async () => {
	const { app, files } = fakeApp(BASE_FILES);
	const { requestUrl, calls } = fakeRequestUrl(classifyResult);
	const notices: string[] = [];

	const ok = await classify(app, requestUrl, NOTE, opts({ notice: (m) => notices.push(m) }));

	assert.equal(ok, true);
	// Request went to the settings-configured endpoint with the key + prompt.
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, AI.apiUrl);
	assert.equal(calls[0].headers.Authorization, `Bearer ${AI.apiKey}`);
	const body = JSON.parse(calls[0].body);
	assert.equal(body.model, AI.model);
	assert.equal(body.messages[0].content, PROMPT);
	assert.ok(body.messages[1].content.includes("买一棵竹子"));
	// Frontmatter got the classification; empty AI status with clearStatus
	// false keeps the existing status (QuickAdd-path semantics).
	assert.match(files[NOTE.path], /category: 生活/);
	assert.match(files[NOTE.path], /subcategory: 购物/);
	assert.match(files[NOTE.path], /summary: 买一棵竹子/);
	assert.match(files[NOTE.path], /status: pending/);
	assert.match(files[NOTE.path], /classified: /);
	assert.ok(notices.some((m) => m.includes("归类完成")));
});

void test("classify updates the _Index: top-level count, level-2 page, detail table", async () => {
	const { app, files } = fakeApp({
		...BASE_FILES,
		"_Index/00-top.md": "# 随手记索引 - 第1层：大类目录\n\n## 生活 (3条)\n→ [[生活|进入]]\n",
		"_Index/生活.md": "### 购物\n→ [[生活-购物|进入]]\n",
		"_Index/生活-购物.md":
			"# 生活 > 购物\n\n| 时间 | 摘要 | 状态 | 笔记 |\n| --- | --- | --- | --- |\n| 2026-11-17 | 旧记录 | - | [[Inbox/old.md]] |\n",
	});
	const { requestUrl } = fakeRequestUrl(classifyResult);

	const ok = await classify(app, requestUrl, NOTE, opts());

	assert.equal(ok, true);
	assert.match(files["_Index/00-top.md"], /## 生活 \(4条\)/);
	assert.match(files["_Index/生活-购物.md"], /\| 2026-11-18 \| 买一棵竹子 \| - \| \[\[Inbox\/2026-11-18-101010\.md\]\] \|/);
	// Existing table header is preserved, new line appended.
	assert.match(files["_Index/生活-购物.md"], /\| 2026-11-17 \| 旧记录/);
});

void test("classify creates missing index pages from scratch", async () => {
	const { app, files } = fakeApp(BASE_FILES);
	const { requestUrl } = fakeRequestUrl(classifyResult);

	const ok = await classify(app, requestUrl, NOTE, opts());

	assert.equal(ok, true);
	assert.match(files["_Index/00-top.md"], /## 生活 \(1条\)/);
	assert.match(files["_Index/生活.md"], /### 购物/);
	assert.match(files["_Index/生活-购物.md"], /# 生活 > 购物/);
	assert.match(files["_Index/生活-购物.md"], /\| 时间 \| 摘要 \| 状态 \| 笔记 \|/);
});

void test("classify with clearStatus:true clears status (draft→published, ADR 0002)", async () => {
	const { app, files } = fakeApp(BASE_FILES);
	const { requestUrl } = fakeRequestUrl(classifyResult);

	const ok = await classify(app, requestUrl, NOTE, opts({ clearStatus: true }));

	assert.equal(ok, true);
	const fm = files[NOTE.path].match(/status: (.*)/)![1];
	assert.equal(fm.trim(), "");
});

void test("classify writes AI-returned status when present (overrides existing)", async () => {
	const { app, files } = fakeApp(BASE_FILES);
	const { requestUrl } = fakeRequestUrl({ ...classifyResult, status: "pending" });

	await classify(app, requestUrl, NOTE, opts({ clearStatus: true }));

	assert.match(files[NOTE.path], /status: pending/);
});

void test("classify parses AI answers wrapped in a ```json block", async () => {
	const { app, files } = fakeApp(BASE_FILES);
	const fenced = "```json\n" + JSON.stringify(classifyResult) + "\n```";
	const { requestUrl } = fakeRequestUrl(fenced);

	const ok = await classify(app, requestUrl, NOTE, opts());

	assert.equal(ok, true);
	assert.match(files[NOTE.path], /category: 生活/);
});

void test("classify fails gracefully on HTTP errors, bad JSON and missing key", async () => {
	const notices: string[] = [];
	const { app } = fakeApp(BASE_FILES);

	const badStatus = fakeRequestUrl("boom", 500);
	assert.equal(await classify(app, badStatus.requestUrl, NOTE, opts({ notice: (m) => notices.push(m) })), false);

	const badJson = fakeRequestUrl("totally not json");
	assert.equal(await classify(app, badJson.requestUrl, NOTE, opts({ notice: (m) => notices.push(m) })), false);

	const noKey = await classify(app, fakeRequestUrl(classifyResult).requestUrl, NOTE, {
		...opts(),
		ai: { apiUrl: AI.apiUrl, apiKey: "", model: AI.model },
		notice: (m: string) => notices.push(m),
	});
	assert.equal(noKey, false);
	assert.ok(notices.some((m) => m.includes("API key")));
});

void test("classify returns false (not a throw) when index writes fail — ADR 0004 contract", async () => {
	const notices: string[] = [];
	const { app } = fakeApp(BASE_FILES);
	app.vault.adapter.write = async () => {
		throw new Error("disk full");
	};

	const ok = await classify(app, fakeRequestUrl(classifyResult).requestUrl, NOTE, opts({ notice: (m) => notices.push(m) }));

	assert.equal(ok, false);
	assert.ok(notices.some((m) => m.includes("归类错误")));
});

void test("localStamp — 本地时区 24H 时间戳，不再输出 UTC（classified 时区修复）", () => {
	// 固定一个 UTC 时刻：2026-11-20T15:30:00Z。东八区应为 23:30，UTC 直取会差 8h。
	const utc = new Date("2026-11-20T15:30:00Z");
	const stamp = localStamp(utc);
	assert.match(stamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
	// 平移量 = 本机时区偏移：期望值 = UTC + (-offset 分钟)
	const expected = new Date(utc.getTime() - utc.getTimezoneOffset() * 60000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");
	assert.equal(stamp, expected);
});
