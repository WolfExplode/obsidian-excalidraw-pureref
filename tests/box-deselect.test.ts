import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { elementInBox, subtractBoxFromSelection, type DeselectElement, type SceneBox } from "../src/box-deselect";

const el = (over: Partial<DeselectElement> & { id: string }): DeselectElement => ({
	type: "image",
	x: 0,
	y: 0,
	width: 100,
	height: 100,
	...over,
});

const box = (minX: number, minY: number, maxX: number, maxY: number): SceneBox => ({ minX, minY, maxX, maxY });

const ids = (record: Record<string, boolean>) => Object.keys(record).sort();

describe("elementInBox", () => {
	it("contain needs the whole element inside; overlap any touch", () => {
		const e = el({ id: "a" });
		assert.equal(elementInBox(e, box(-10, -10, 110, 110), "contain"), true);
		assert.equal(elementInBox(e, box(50, 50, 200, 200), "contain"), false);
		assert.equal(elementInBox(e, box(50, 50, 200, 200), "overlap"), true);
		assert.equal(elementInBox(e, box(150, 150, 200, 200), "overlap"), false);
	});

	it("tests a rotated element's real shape, not its bounding box", () => {
		// A 100x100 square rotated 45° about (50,50): its AABB reaches (-20.7,-20.7),
		// but the top-left corner region of that AABB is empty.
		const e = el({ id: "a", angle: Math.PI / 4 });
		assert.equal(elementInBox(e, box(-20, -20, -5, -5), "overlap"), false);
		assert.equal(elementInBox(e, box(40, -20, 60, 0), "overlap"), true);
	});

	it("uses a linear element's point extent, including negative points", () => {
		const line = el({ id: "l", type: "line", x: 100, y: 0, width: 100, height: 0, points: [[0, 0], [-100, 0]] });
		assert.equal(elementInBox(line, box(-1, -1, 101, 1), "contain"), true);
		assert.equal(elementInBox(line, box(99, -1, 201, 1), "contain"), false);
	});
});

describe("subtractBoxFromSelection", () => {
	const base = { selectedGroupIds: {}, editingGroupId: null, mode: "overlap" as const };

	it("removes only caught elements from the selection", () => {
		const elements = [el({ id: "a" }), el({ id: "b", x: 200 }), el({ id: "c", x: 400 })];
		const next = subtractBoxFromSelection({
			...base,
			elements,
			selectedElementIds: { a: true, b: true },
			box: box(-10, -10, 250, 50),
		});
		// c is caught but was never selected, so it stays unselected.
		assert.deepEqual(ids(next.selectedElementIds), []);
		const partial = subtractBoxFromSelection({
			...base,
			elements,
			selectedElementIds: { a: true, b: true, c: true },
			box: box(190, 0, 210, 10),
		});
		assert.deepEqual(ids(partial.selectedElementIds), ["a", "c"]);
	});

	it("deselects a whole group when any member is caught", () => {
		const elements = [
			el({ id: "a", groupIds: ["g"] }),
			el({ id: "b", x: 500, groupIds: ["g"] }),
			el({ id: "c", x: 1000 }),
		];
		const next = subtractBoxFromSelection({
			...base,
			elements,
			selectedElementIds: { a: true, b: true, c: true },
			selectedGroupIds: { g: true },
			box: box(0, 0, 10, 10),
		});
		assert.deepEqual(ids(next.selectedElementIds), ["c"]);
		assert.deepEqual(ids(next.selectedGroupIds), []);
	});

	it("treats members individually while their group is being edited", () => {
		const elements = [el({ id: "a", groupIds: ["g"] }), el({ id: "b", x: 500, groupIds: ["g"] })];
		const next = subtractBoxFromSelection({
			...base,
			elements,
			editingGroupId: "g",
			selectedElementIds: { a: true, b: true },
			box: box(0, 0, 10, 10),
		});
		assert.deepEqual(ids(next.selectedElementIds), ["b"]);
	});

	it("removes bound text together with its container", () => {
		const elements = [el({ id: "box", type: "rectangle" }), el({ id: "t", type: "text", x: 1000, containerId: "box" })];
		const next = subtractBoxFromSelection({
			...base,
			elements,
			selectedElementIds: { box: true, t: true },
			box: box(0, 0, 10, 10),
		});
		assert.deepEqual(ids(next.selectedElementIds), []);
	});
});
