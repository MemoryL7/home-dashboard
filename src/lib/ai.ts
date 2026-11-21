/**
 * AI call infrastructure for the plugin — the single seam every AI feature
 * (classify, weekly review, …) goes through. requestUrl is injected by the
 * caller (Obsidian's renderer blocks plain fetch with CORS), so this module
 * stays Node-loadable.
 */

/** Connection settings, sourced from the plugin settings page. */
export interface AIConfig {
	apiUrl: string;
	apiKey: string;
	model: string;
}

/** Minimal shape of Obsidian's requestUrl the core depends on. */
export type RequestUrlLike = (opts: {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string;
}) => Promise<{ status: number; text: string; json?: unknown }>;

export interface CallAIOpts {
	system: string;
	user: string;
	/** Notice callback for failure reporting; default silent. */
	notice?: (msg: string) => void;
}

/**
 * Shared sender for every AI feature — the single seam lives here. Sends one
 * chat-completion request, reports missing key / HTTP / network failure via
 * `notice`, and returns the raw answer text (null on failure).
 */
async function postChat(
	requestUrl: RequestUrlLike,
	ai: AIConfig,
	opts: { system: string; user: string; temperature: number; responseFormat?: unknown },
	notice: (msg: string) => void,
): Promise<string | null> {
	if (!ai.apiKey) {
		notice("❌ 未配置 API key（插件设置 → AI 接口）");
		return null;
	}
	try {
		const resp = await requestUrl({
			url: ai.apiUrl,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${ai.apiKey}`,
			},
			body: JSON.stringify({
				model: ai.model,
				temperature: opts.temperature,
				messages: [
					{ role: "system", content: opts.system },
					{ role: "user", content: opts.user },
				],
				...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
			}),
		});
		if (resp.status >= 400) {
			notice(`❌ API错误: ${resp.status} ${String(resp.text).slice(0, 100)}`);
			return null;
		}
		return (
			(resp.json as { choices?: { message?: { content?: string } }[] })
				?.choices?.[0]?.message?.content ?? ""
		) as string;
	} catch (e) {
		notice(`❌ AI调用错误: ${(e as Error).message}`);
		return null;
	}
}

/**
 * Send one chat-completion request and parse the answer as JSON. Loose
 * parsing: prefer the whole body, fall back to the first ```json block.
 * Returns the parsed object, or null on HTTP/parse failure (reason goes to
 * `notice`).
 */
export async function callAI(
	requestUrl: RequestUrlLike,
	ai: AIConfig,
	opts: CallAIOpts,
): Promise<Record<string, unknown> | null> {
	const notice = opts.notice ?? (() => {});
	const raw = await postChat(
		requestUrl,
		ai,
		{ system: opts.system, user: opts.user, temperature: 0.1, responseFormat: { type: "json_object" } },
		notice,
	);
	return raw === null ? null : parseLooseJson(raw, notice);
}

/** Loose JSON: whole-body parse first, ```json fence as fallback. */
export function parseLooseJson(
	raw: string,
	notice: (msg: string) => void,
): Record<string, unknown> | null {
	try {
		return JSON.parse(raw);
	} catch {
		const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (!m) {
			notice("❌ JSON解析失败");
			return null;
		}
		try {
			return JSON.parse(m[1].trim());
		} catch {
			notice("❌ JSON解析失败");
			return null;
		}
	}
}

export interface CallAITextOpts extends CallAIOpts {
	/** Sampling temperature; weekly review uses the old script's 0.4. */
	temperature?: number;
}

/**
 * Send one chat-completion request and return the answer as free text
 * (Markdown). Unlike callAI there is no response_format: the weekly review
 * wants prose, not JSON. Returns the trimmed text, or null on missing key /
 * HTTP / network failure (reason goes to `notice`).
 */
export async function callAIText(
	requestUrl: RequestUrlLike,
	ai: AIConfig,
	opts: CallAITextOpts,
): Promise<string | null> {
	const notice = opts.notice ?? (() => {});
	const content = await postChat(
		requestUrl,
		ai,
		// 周回顾沿用旧脚本的 0.4：散文要一点随机，不要 JSON 模式
		{ system: opts.system, user: opts.user, temperature: opts.temperature ?? 0.4 },
		notice,
	);
	return content === null ? null : content.trim() || null;
}
