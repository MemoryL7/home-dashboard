import { Notice, requestUrl } from "obsidian";
import type HomeDashboardPlugin from "../main";
import { captureAndClassify, type CaptureDeps } from "./capture";
import { resolveConventions } from "./conventions";
import { DEFAULT_CLASSIFY_PROMPT } from "./prompts";

/**
 * UI-side glue shared by the Home capture card and the command-palette
 * modal: derives CaptureDeps from plugin settings and runs one capture.
 * (lib/capture.ts stays obsidian-free; Notice/requestUrl enter here.)
 */
export async function runCapture(
	plugin: HomeDashboardPlugin,
	text: string,
	onClear?: () => void,
): Promise<boolean> {
	const conventions = resolveConventions(plugin.settings);
	return captureAndClassify(plugin.app, text, {
		requestUrl,
		ai: {
			apiUrl: plugin.settings.apiUrl,
			apiKey: plugin.settings.apiKey,
			model: plugin.settings.aiModel,
		},
		prompt: plugin.settings.classifyPrompt.trim() || DEFAULT_CLASSIFY_PROMPT,
		inboxDir: conventions.inboxDir,
		indexDir: conventions.indexDir,
		notice: (m) => new Notice(m),
		onClassified: onClear,
	});
}

export type { CaptureDeps };
