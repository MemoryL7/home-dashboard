/* ============================================================
   logo-core —— logo 图片导入的纯逻辑（不碰 Obsidian API）。
   - isImagePath：判定路径是否按图片处理（字符图标 / 图片的分界）；
   - resolveImportPath：拖入图片的落盘路径 —— 目标目录 + 原文件名，
     重名追加 -2/-3…，不覆盖既有文件。
   DOM 与 vault 接线在 home-view.ts / logo-ui.ts，路径口径以本文件为准。
   ============================================================ */

/** 库内图片的判定口径：home-view 的图片渲染与 logo 选择器共用。 */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

/** 拖入/粘贴 logo 的提示文案与落点目录默认值（settings 默认值共用后者）。 */
export const LOGO_HINT = "点击选库内图片，或直接把图片拖到这上面";
export const LOGO_DIR_DEFAULT = ".assets";

export function isImagePath(path: string): boolean {
	return IMAGE_EXT_RE.test(path);
}

/** vault 文件系统的最小切片（与 lib/init.ts 的 VaultFs 同形子集）。 */
export interface LogoFs {
	exists(normalizedPath: string): Promise<boolean>;
}

/** 文件名清洗：目录分隔符与非法字符替换为 -，防拖入名带路径段。 */
export function sanitizeName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "logo.png";
}

/**
 * 纯（异步但确定性）：返回 dir 下不冲突的落盘路径。
 * 同名存在时追加 -2、-3…（保留扩展名）；dir 头尾斜杠容忍。
 */
export async function resolveImportPath(
	fs: LogoFs,
	dir: string,
	sourceName: string,
): Promise<string> {
	const clean = (dir ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	const name = sanitizeName(sourceName);
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : "";
	let candidate = `${clean}/${name}`;
	let i = 1;
	while (await fs.exists(candidate)) {
		i += 1;
		candidate = `${clean}/${stem}-${i}${ext}`;
	}
	return candidate;
}
