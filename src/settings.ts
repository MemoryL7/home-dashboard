import { App, PluginSettingTab, Setting } from "obsidian";
import type HomeDashboardPlugin from "./main";
import { HOME_VIEW_TYPE } from "./lib/choose-leaf";
import { DEFAULT_CONVENTIONS, type ConventionsInput } from "./lib/conventions";
import { LOGO_DIR_DEFAULT } from "./lib/logo-core";
import { PROFILE_DEFAULTS } from "./lib/profile";

/**
 * Plugin settings. `apiKey` lives only in the plugin's data.json (inside
 * .obsidian/plugins/home-dashboard/) — it is never written into any note in
 * the vault. Path conventions carry defaults so a fresh vault needs zero
 * configuration.
 */
export interface HomeDashboardSettings extends ConventionsInput {
	apiKey: string;
	/** Chat-completions endpoint, e.g. https://host/v1/chat/completions. */
	apiUrl: string;
	/** Model name sent to the API, e.g. deepseek-chat. */
	aiModel: string;
	/** Classify prompt override; empty = built-in default (lib/prompts.ts). */
	classifyPrompt: string;
	/** Weekly-review prompt override; empty = built-in default (lib/prompts.ts). */
	reviewPrompt: string;
	/** 启动 Obsidian 后自动打开 Home 视图（票 09）。 */
	openOnStartup: boolean;
	/** 侧栏个人信息（票 10 自旧 Home.md frontmatter 迁入插件设置）。 */
	profileName: string;
	/** logo：库内图片路径（png/jpg/gif/webp/svg）渲染图片，否则当字符图标。 */
	profileLogo: string;
	profileTagline: string;
	/** 拖入/粘贴 logo 图片的落点目录（点目录在文件树中隐藏，如 .assets）。 */
	logoDir: string;
}

export const DEFAULT_SETTINGS: HomeDashboardSettings = {
	...DEFAULT_CONVENTIONS,
	apiKey: "",
	apiUrl: "",
	aiModel: "",
	classifyPrompt: "",
	reviewPrompt: "",
	openOnStartup: true,
	profileName: PROFILE_DEFAULTS.name,
	profileLogo: PROFILE_DEFAULTS.logo,
	profileTagline: PROFILE_DEFAULTS.tagline,
	logoDir: LOGO_DIR_DEFAULT,
};

export class HomeDashboardSettingTab extends PluginSettingTab {
	private plugin: HomeDashboardPlugin;

	constructor(app: App, plugin: HomeDashboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("个人信息").setHeading();

		const profileField = (
			name: string,
			desc: string,
			key: "profileName" | "profileLogo" | "profileTagline",
		): void => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addText((text) =>
					text.setValue(this.plugin.settings[key]).onChange(async (value) => {
						this.plugin.settings[key] = value.trim();
						await this.plugin.saveSettings();
						// 打开中的 Home 视图就地重绘侧栏，不用重开视图
						for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW_TYPE)) {
							(leaf.view as { refreshProfile?: () => void }).refreshProfile?.();
						}
					}),
				);
		};
		profileField("名字", "侧栏显示的名字。", "profileName");
		profileField(
			"Logo",
			"库内图片路径（png/jpg/gif/webp/svg）则渲染图片，否则当作字符图标。",
			"profileLogo",
		);
		profileField("签名", "名字下方的一句话签名。", "profileTagline");

		new Setting(containerEl).setName("启动").setHeading();
		new Setting(containerEl)
			.setName("启动即主页")
			.setDesc("Obsidian 启动后自动打开 Home 视图（替代 Homepage 插件）。")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.openOnStartup = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("AI 接口").setHeading();

		const textField = (
			setting: Setting,
			key: "apiKey" | "apiUrl" | "aiModel",
			description: string,
		): void => {
			setting.setDesc(description).addText((text) =>
				text.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value.trim();
					await this.plugin.saveSettings();
				}),
			);
		};

		textField(
			new Setting(containerEl).setName("API key"),
			"apiKey",
			"仅保存在插件设置(data.json)中，不写入任何笔记文件。",
		);
		textField(
			new Setting(containerEl).setName("API 地址"),
			"apiUrl",
			"Chat-completions 完整端点，如 https://host/v1/chat/completions",
		);
		textField(
			new Setting(containerEl).setName("模型"),
			"aiModel",
			"发送给 API 的模型名，如 deepseek-chat",
		);

		// 提示词覆盖共用一个形状：留空 = 插件内置默认（lib/prompts.ts）
		const promptField = (name: string, desc: string, key: "classifyPrompt" | "reviewPrompt"): void => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addTextArea((text) => {
					text.inputEl.rows = 8;
					text.inputEl.style.width = "100%";
					return text
						.setValue(this.plugin.settings[key])
						.onChange(async (value) => {
							this.plugin.settings[key] = value;
							await this.plugin.saveSettings();
						});
				});
		};

		promptField(
			"归类提示词覆盖",
			"留空使用插件内置默认提示词（lib/prompts.ts 内置默认）。",
			"classifyPrompt",
		);
		promptField(
			"周回顾提示词覆盖",
			"留空使用插件内置默认提示词（lib/prompts.ts 内置默认）。",
			"reviewPrompt",
		);

		new Setting(containerEl).setName("路径约定").setHeading();

		const pathField = (
			setting: Setting,
			key: keyof ConventionsInput,
			description: string,
		): void => {
			setting
				.setDesc(`${description}（默认 ${DEFAULT_CONVENTIONS[key]}）`)
				.addText((text) =>
					text
						.setValue(this.plugin.settings[key] ?? "")
						.onChange(async (value) => {
							this.plugin.settings[key] = value;
							await this.plugin.saveSettings();
						}),
				);
		};

		pathField(
			new Setting(containerEl).setName("Inbox 目录"),
			"inboxDir",
			"随手记落点目录",
		);
		pathField(
			new Setting(containerEl).setName("索引目录"),
			"indexDir",
			"索引页目录",
		);
		pathField(
			new Setting(containerEl).setName("周回顾目录"),
			"reviewsDir",
			"周回顾笔记落点目录",
		);
		new Setting(containerEl)
			.setName("Logo 目录")
			.setDesc(
				`拖入/粘贴 logo 图片的落点目录（默认 ${LOGO_DIR_DEFAULT}，点开头目录在文件树中隐藏）`,
			)
			.addText((text) =>
				text.setValue(this.plugin.settings.logoDir).onChange(async (value) => {
					this.plugin.settings.logoDir = value.trim();
					await this.plugin.saveSettings();
				}),
			);
	}
}
