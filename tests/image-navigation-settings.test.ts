import { test } from "node:test";
import assert from "node:assert/strict";
import { ImageNavigationSettings } from "../src/image-navigation-settings";
import { PluginDataWriter } from "../src/plugin-data-writer";

test("navigation defaults on, persists across reload, and preserves other plugin records", async () => {
	let data: unknown = { geometry: { board: "position" }, hotkeys: { custom: "binding" } };
	const writer = new PluginDataWriter({ loadData: async () => data, saveData: async value => { data = value; } });
	const settings = new ImageNavigationSettings(writer);
	await settings.load(); assert.equal(settings.getEnabled(), true);
	let changes = 0; const stop = settings.onChange(() => changes++);
	await settings.setEnabled(false);
	const reloaded = new ImageNavigationSettings(writer); await reloaded.load();
	assert.equal(reloaded.getEnabled(), false); assert.equal(changes, 1);
	assert.deepEqual(data, { geometry: { board: "position" }, hotkeys: { custom: "binding" }, imageNavigation: { enabled: false } });
	stop(); await settings.setEnabled(true); assert.equal(changes, 1);
});

test("failed preference writes leave the active feature and listeners unchanged", async () => {
	const writer = new PluginDataWriter({ loadData: async () => ({ imageNavigation: { enabled: "invalid" } }),
		saveData: async () => { throw new Error("disk unavailable"); } });
	const settings = new ImageNavigationSettings(writer); await settings.load();
	let changes = 0; settings.onChange(() => changes++);
	await assert.rejects(settings.setEnabled(false), /disk unavailable/);
	assert.equal(settings.getEnabled(), true); assert.equal(changes, 0);
});
