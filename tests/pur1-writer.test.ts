import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { readPureRef1Scene } from "../src/pur1-reader";
import { transformPoint } from "../src/pur2-reader";
import { writePureRef1Images } from "../src/pur1-writer";

const png = readPureRef1Scene(readFileSync("tests/fixtures/pur1-image-note.pur")).images[0].data;

describe("PureRef 1.x image writer", () => {
	it("writes image pixels, order, and placement that the independent reader recovers", () => {
		const bytes = writePureRef1Images([
			{ png, x: -40, y: 12, width: 80, height: 60 },
			{ png, x: 100, y: 50, width: 20, height: 30 },
		]);
		const scene = readPureRef1Scene(bytes);
		assert.equal(scene.imageItems.length, 2);
		assert.deepEqual(scene.items.map((item) => item.z), [1, 2]);
		assert.deepEqual(scene.images.map((image) => Buffer.from(image.data).equals(png)), [true, true]);
		const rects = scene.imageItems.map((placed) => {
			const item = scene.items.find((entry) => entry.id === placed.id)!;
			const corners = placed.bounds.map((point) => transformPoint(item.transform, point));
			return [Math.min(...corners.map((p) => p.x)), Math.min(...corners.map((p) => p.y)),
				Math.max(...corners.map((p) => p.x)), Math.max(...corners.map((p) => p.y))];
		});
		assert.deepEqual(rects, [[-40, 12, 40, 72], [100, 50, 120, 80]]);
	});

	it("handles a large image payload without expanding it into a JavaScript array", () => {
		const large = new Uint8Array(24 * 1024 * 1024);
		large.set(png);
		const output = writePureRef1Images([{ png: large, x: 0, y: 0, width: 4, height: 4 }]);
		assert.equal(output.length > large.length, true);
		assert.equal(readPureRef1Scene(output).images[0].data.length, large.length);
	});

	it("includes standalone text", () => {
		const scene = readPureRef1Scene(writePureRef1Images([{ png, x: 0, y: 0, width: 4, height: 4, order: 2 }],
			[{ text: "hello", x: 40, y: 60, fontSize: 20, order: 1 }]));
		assert.equal(scene.notes.length, 1);
		assert.equal(scene.notes[0].html, "hello");
		assert.deepEqual(scene.items[1].transform.slice(6, 8), [40, 60]);
		assert.equal(scene.items[1].transform[0], 80 / 22);
		assert.deepEqual(scene.items.map((item) => item.z), [2, 1]);
	});
});
