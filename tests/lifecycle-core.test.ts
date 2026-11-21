import assert from "node:assert/strict";
import { test } from "node:test";
import {
	BODY_CLEANUP_CLASSES,
	shouldOpenOnStartup,
} from "../src/lib/lifecycle-core";

test("shouldOpenOnStartup: 默认打开（缺省值视为开启）", () => {
	assert.equal(shouldOpenOnStartup({}), true);
	assert.equal(shouldOpenOnStartup({ openOnStartup: true }), true);
});

test("shouldOpenOnStartup: 设置可关闭", () => {
	assert.equal(shouldOpenOnStartup({ openOnStartup: false }), false);
});

test("BODY_CLEANUP_CLASSES 覆盖插件用到的全部 body 级 class", () => {
	assert.deepEqual([...BODY_CLEANUP_CLASSES].sort(), ["home-v2", "home-zen"]);
});
