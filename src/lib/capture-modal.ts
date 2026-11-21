import { Modal } from "obsidian";
import type HomeDashboardPlugin from "../main";
import { runCapture } from "./capture-ui";
import { putIcon, ICON_BTN } from "./icon";

/**
 * Command-palette front end of quick capture: a Modal with one textarea.
 * Thin DOM shell — the pipeline itself lives in lib/capture.ts, the settings
 * glue in lib/capture-ui.ts. Inline styles are deliberate: modal content
 * lives outside the `.home-dashboard.home-v2` root, so styles.css rules
 * (which must all carry that prefix) would not reach it.
 */
export class CaptureModal extends Modal {
	private plugin: HomeDashboardPlugin;

	constructor(plugin: HomeDashboardPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen(): void {
		this.titleEl.setText("随手记 + AI 归类");
		const input = this.contentEl.createEl("textarea", {
			attr: { placeholder: "随手记点什么…（Ctrl+Enter 快速归类）" },
		});
		input.style.width = "100%";
		input.style.minHeight = "96px";
		const foot = this.contentEl.createDiv();
		foot.style.display = "flex";
		foot.style.justifyContent = "flex-end";
		foot.style.marginTop = "8px";
		const button = foot.createEl("button", {}, (btn) => {
			putIcon(btn, "sparkles", ICON_BTN);
			btn.createSpan({ text: " AI 归类" });
		});
		const submit = (): void => {
			void this.submit(input.value, button);
		};
		button.addEventListener("click", submit);
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
		});
		window.setTimeout(() => input.focus(), 50);
	}

	private async submit(text: string, button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		try {
			const ok = await runCapture(this.plugin, text);
			if (ok) this.close(); // keep the modal (and the text) on failure
		} finally {
			button.disabled = false;
		}
	}
}
