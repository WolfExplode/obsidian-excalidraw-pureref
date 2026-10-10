import assert from "node:assert/strict";
import { it } from "node:test";
import { centerPureRefImport } from "../src/pur-import-placement";

it("centers a distant PureRef layout at the drop point without changing spacing or size", () => {
	const images = [
		{ x: 100000, y: -200000, width: 100, height: 200 },
		{ x: 100300, y: -199900, width: 200, height: 100 },
	];
	centerPureRefImport(images, { x: -800, y: 1200 });
	assert.deepEqual(images, [
		{ x: -1050, y: 1100, width: 100, height: 200 },
		{ x: -750, y: 1200, width: 200, height: 100 },
	]);
});

it("includes measured notes in the group's bounds and preserves appearance", () => {
	const elements = [
		{ x: -100, y: -50, width: 200, height: 100, opacity: 50, locked: true },
		{ x: 200, y: 100, width: 100, height: 50, opacity: 100, locked: false },
	];
	centerPureRefImport(elements, { x: 0, y: 0 });
	assert.deepEqual(elements, [
		{ x: -200, y: -100, width: 200, height: 100, opacity: 50, locked: true },
		{ x: 100, y: 50, width: 100, height: 50, opacity: 100, locked: false },
	]);
});

it("centers a note-only import using its measured dimensions", () => {
	const notes = [{ x: -5000, y: 8000, width: 80, height: 20 }];
	centerPureRefImport(notes, { x: 300, y: 400 });
	assert.deepEqual(notes, [{ x: 260, y: 390, width: 80, height: 20 }]);
});

it("accepts an empty import", () => {
	const elements: { x: number; y: number; width: number; height: number }[] = [];
	centerPureRefImport(elements, { x: 10, y: 20 });
	assert.deepEqual(elements, []);
});
