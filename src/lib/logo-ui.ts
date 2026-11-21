import { FuzzySuggestModal, TFile } from "obsidian";
import { isImagePath } from "./logo-core";

/**
 * 库内图片模糊选择器（logo 挑选入口之一）：Obsidian 原生 FuzzySuggestModal
 * 手感，与 @[[]] 选文件一致。只列 vault.getFiles() 里的图片（含点目录）。
 */
export class ImageSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: FuzzySuggestModal<TFile>["app"],
		private onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder("选择库内图片作为 Logo…");
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => isImagePath(f.path));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}
