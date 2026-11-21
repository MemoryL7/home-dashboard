import type { WorkspaceLeaf } from "obsidian";

/**
 * Pure seam for the "open or focus" behaviour: if a Home leaf already exists
 * anywhere in the workspace, reuse (focus) it; otherwise create one via the
 * provided factory. Kept side-effect-free so it can be unit-tested without a
 * running Obsidian app.
 */
export function chooseLeaf<
	TLeaf extends { view: { getViewType(): string } },
>(
	existingLeaves: readonly TLeaf[],
	createLeaf: () => TLeaf | null,
): TLeaf | null {
	const found = existingLeaves.find(
		(leaf) => leaf.view.getViewType() === HOME_VIEW_TYPE,
	);
	if (found) return found;
	return createLeaf();
}

export const HOME_VIEW_TYPE = "home-dashboard-view";
