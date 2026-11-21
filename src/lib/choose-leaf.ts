import type { Workspace, WorkspaceLeaf } from "obsidian";

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

/**
 * Focus a leaf that was just activated via setViewState({ active: true }).
 * Workspace.revealLeaf is newer than our minAppVersion (1.5.0), so guard on
 * its existence — on older builds setViewState alone already brings the leaf
 * to the front, and revealLeaf is only a focus refinement.
 */
export async function revealLeafSafe(workspace: Workspace, leaf: WorkspaceLeaf): Promise<void> {
	const w = workspace as Workspace & { revealLeaf?: (leaf: WorkspaceLeaf) => unknown };
	if (typeof w.revealLeaf === "function") await w.revealLeaf(leaf);
}
