/** Path conventions the plugin reads/writes; configurable in settings. */
export interface Conventions {
	/** Vault-root-relative directory all quick notes land in. */
	inboxDir: string;
	/** Vault-root-relative directory holding index pages. */
	indexDir: string;
	/** Vault-root-relative directory weekly reviews are written into. */
	reviewsDir: string;
}

export const DEFAULT_CONVENTIONS: Conventions = {
	inboxDir: "Inbox",
	indexDir: "_Index",
	reviewsDir: "Reviews",
};

export type ConventionsInput = Partial<Conventions>;

/**
 * Pure: merge stored settings over the defaults, field by field, trimming
 * stray whitespace. Initialization and all reads/writes go through this, so a
 * changed convention takes effect without touching call sites.
 */
export function resolveConventions(input: ConventionsInput): Conventions {
	const pick = (value: string | undefined, fallback: string): string => {
		const trimmed = (value ?? "").trim();
		return trimmed.length > 0 ? trimmed : fallback;
	};
	return {
		inboxDir: pick(input.inboxDir, DEFAULT_CONVENTIONS.inboxDir),
		indexDir: pick(input.indexDir, DEFAULT_CONVENTIONS.indexDir),
		reviewsDir: pick(input.reviewsDir, DEFAULT_CONVENTIONS.reviewsDir),
	};
}
