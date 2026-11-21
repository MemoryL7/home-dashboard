import { normalizePath } from "obsidian";
import type { Conventions } from "./conventions";

/** Minimal adapter surface, mirroring DataAdapter, for testability. */
export interface VaultFs {
	exists(normalizedPath: string): Promise<boolean>;
	mkdir(normalizedPath: string): Promise<void>;
}

/**
 * First-run initialization: create Inbox/ and _Index/ on demand. Idempotent —
 * safe to run on every load. (The thin Home entry note this module used to
 * generate was removed at ticket 10: the dashboard is a plugin view opened at
 * startup, so an anchor note in the vault served no purpose.)
 */
export async function ensureDirs(
	fs: VaultFs,
	conventions: Pick<Conventions, "inboxDir" | "indexDir">,
): Promise<void> {
	for (const dir of [conventions.inboxDir, conventions.indexDir]) {
		if (!(await fs.exists(normalizePath(dir)))) {
			await fs.mkdir(normalizePath(dir));
		}
	}
}
