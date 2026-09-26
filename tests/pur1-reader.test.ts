import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { readPureRef1Scene } from "../src/pur1-reader";

// Written by the independent PureRef-format 1.10 reference writer.
const fixture = readFileSync(new URL("../tests/fixtures/pur1-image-note.pur", import.meta.url));

describe("PureRef 1.x reader", () => {
	it("resolves duplicate images and preserves parented text and placement", () => {
		const scene = readPureRef1Scene(fixture);
		assert.equal(scene.imageItems.length, 2);
		assert.equal(scene.images.length, 1);
		assert.deepEqual(scene.imageItems.map(({ imageId }) => imageId), [0, 0]);
		assert.deepEqual(scene.images.map(({ width, height }) => [width, height]), [[1, 1]]);
		assert.deepEqual(scene.items.map(({ id, parent, z }) => [id, parent, z]), [
			[0, -1, 2], [3, 0, 3], [1, -1, 4], [2, -1, 5],
		]);
		assert.deepEqual(scene.notes.map(({ id, html }) => [id, html]), [[3, "caption"], [2, "hello"]]);
		assert.deepEqual(scene.items.find(({ id }) => id === 1)?.transform, [2, 0, 0, 0, 2, 0, 20, 5, 1]);
	});

	it("rejects a damaged payload before importing media", () => {
		const changed = fixture.slice();
		changed[230] ^= 1;
		assert.throws(() => readPureRef1Scene(changed), /checksum mismatch/);
	});
});
