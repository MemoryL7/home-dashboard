import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseLeaf } from "../src/lib/choose-leaf";

function leaf(viewType: string) {
	return { view: { getViewType: () => viewType } };
}

test("chooses the existing Home leaf when one exists", () => {
	const existing = leaf("home-dashboard-view");
	const others = [leaf("markdown"), existing, leaf("empty")];
	assert.equal(chooseLeaf(others, () => null), existing);
});

test("creates a new leaf when no Home leaf exists", () => {
	const created = leaf("home-dashboard-view");
	assert.equal(
		chooseLeaf([], () => created),
		created,
	);
});

test("passes the missing-leaf branch a callback only when needed", () => {
	let created = false;
	chooseLeaf([leaf("home-dashboard-view")], () => {
		created = true;
		return null;
	});
	assert.equal(created, false);
});
