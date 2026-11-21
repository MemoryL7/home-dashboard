/**
 * 个人信息的内置默认值（票 10）：settings.ts 的 DEFAULT_SETTINGS 与
 * home-view.ts 的渲染回退共用这一份，避免字面量在两处漂移。
 */
export const PROFILE_DEFAULTS = {
	name: "随手记",
	logo: "竹",
	tagline: "竹下随手 · 一日一记",
} as const;
