// daylog-core 测试 —— 自 Scripts/daylog-core.test.js 原样迁移（票 05）。
// 断言与原 Node 脚本逐条对应；仅外壳从手写 eq()/exit 换成 node:test，
// 加载缝（adapter.read + new Function）由插件打包后的 import 取代。
import { test } from "node:test";
import assert from "node:assert/strict";
import { daylogCore } from "../src/lib/daylog-core";

// 1. 常量表（日界 08:00，ADR 0005 修订）
test("48 个半小时格", () => {
	assert.equal(daylogCore.SLOTS.length, 48);
});
test("首格 08:00-08:30", () => {
	assert.equal(daylogCore.SLOTS[0], "08:00-08:30");
});
test("午夜边界 31→24:00", () => {
	assert.equal(daylogCore.SLOTS[31], "23:30-24:00");
});
test("凌晨段接次日 00:00-00:30", () => {
	assert.equal(daylogCore.SLOTS[32], "00:00-00:30");
});
test("末格收在次日 08:00", () => {
	assert.equal(daylogCore.SLOTS[47], "07:30-08:00");
});
test("TYPE_BY 与 TYPES 对齐", () => {
	assert.equal(daylogCore.TYPE_BY.quality, daylogCore.TYPES[0]);
});

// 1.5 dayDate：08:00 日界（2026-11 自 daylog-view 的 daylogDayDate 收编进 core）
const at = (y: number, m: number, d: number, h: number, min = 0): number =>
	new Date(y, m - 1, d, h, min, 0, 0).getTime();
test("dayDate 08:00 起算：8 点整已属当天", () => {
	assert.equal(daylogCore.dayDate(at(2026, 11, 21, 8)), "2026-11-21");
});
test("dayDate 07:59 归前一天", () => {
	assert.equal(daylogCore.dayDate(at(2026, 11, 21, 7, 59)), "2026-11-20");
});
test("dayDate 白天与深夜都属当天", () => {
	assert.equal(daylogCore.dayDate(at(2026, 11, 21, 12)), "2026-11-21");
	assert.equal(daylogCore.dayDate(at(2026, 11, 21, 23, 30)), "2026-11-21");
});
test("dayDate 凌晨 0 点归前一天", () => {
	assert.equal(daylogCore.dayDate(at(2026, 11, 21, 0, 0)), "2026-11-20");
});
test("dayDate 跨月回退", () => {
	assert.equal(daylogCore.dayDate(at(2026, 12, 1, 3)), "2026-11-30");
});

// 2. 序列化往返：只写有内容的行，空行不落表
const rows = {
	[daylogCore.SLOTS[10]]: { desc: "写代码", type: "quality" },
	[daylogCore.SLOTS[30]]: { desc: "", type: "rest" }, // 只有类型，保留
	[daylogCore.SLOTS[40]]: { desc: "刷手机", type: "unknown" }, // 非 TYPE_BY 内的类型 → 清空保留行
};
const round = daylogCore.parse(daylogCore.serialize(rows));
test("有内容的 3 行往返后仍在", () => {
	assert.equal(Object.keys(round).length, 3);
});
test("行内容往返一致", () => {
	assert.deepEqual(round[daylogCore.SLOTS[10]], { desc: "写代码", type: "quality" });
});
test("未知类型被清空", () => {
	assert.equal(round[daylogCore.SLOTS[40]].type, "");
});

// 3. read/save 往返（假 adapter）
const files: Record<string, string> = {};
const fakeApp = {
	vault: {
		adapter: {
			read: async (p: string) => {
				if (!(p in files)) throw new Error("not found");
				return files[p];
			},
			write: async (p: string, body: string) => {
				files[p] = body;
			},
		},
	},
};
test("save → read 全量往返一致", async () => {
	await daylogCore.save(fakeApp, "2026-11-12", rows);
	assert.ok(
		files["Inbox/2026-11-12.md"].startsWith("---\ntype: daylog\ndate: 2026-11-12\n---\n"),
		"save 写出 daylog frontmatter",
	);
	const back = await daylogCore.read(fakeApp, "2026-11-12");
	assert.deepEqual(back, round);
});
test("读不存在的日期返回空对象", async () => {
	assert.deepEqual(await daylogCore.read(fakeApp, "2099-01-01"), {});
});

// 4. 路径约定可配置（票 02 的 conventions：Inbox 目录可自定义时，日文件跟着走）
test("自定义 Inbox 目录落到新路径", async () => {
	await daylogCore.save(fakeApp, "2026-11-12", rows, "Journal");
	assert.ok("Journal/2026-11-12.md" in files, "写入配置的目录");
	const back = await daylogCore.read(fakeApp, "2026-11-12", "Journal");
	assert.deepEqual(back, round);
});
