import obsidian from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

/**
 * Obsidian 官方插件审核规则集（eslint-plugin-obsidianmd recommended）。
 * 与 obsidian-releases PR 上的审核机器人跑的是同一批规则，本地跑通即
 * 大概率过审。只跑 obsidian 规则，不开通用 TS 严格性规则（那是另一回事）。
 * 运行：npm run lint
 */
export default tseslint.config(
	{
		ignores: ["node_modules/", "dist-test/", "main.js"],
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
				// tsconfig.json include 覆盖 src/ 与 tests/
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		// esbuild 构建脚本使用 builtin-modules 是官方样例插件的标准做法
		// （构建时枚举外部依赖），该禁用规则只针对运行时依赖。
		files: ["esbuild.config.mjs"],
		rules: { "depend/ban-dependencies": "off" },
	},
	obsidian.configs.recommended,
);
