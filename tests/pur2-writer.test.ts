import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { readPureRef1Scene } from "../src/pur1-reader";
import { databaseFromPur, readPureRefScene, transformPoint } from "../src/pur2-reader";
import { writePureRef2Scene } from "../src/pur2-writer";

const png = readPureRef1Scene(readFileSync("tests/fixtures/pur1-image-note.pur")).images[0].data;

describe("PureRef 2.x writer", () => {
	it("round trips image geometry, pixels, and editable text through the 2.x reader", async () => {
		const output = await writePureRef2Scene([
			{ kind: "image", data: png, format: "png", sourceWidth: 1, sourceHeight: 1,
				crop: { x: 0, y: 0, width: 1, height: 1 }, x: 10, y: 20, width: 30, height: 40,
				angle: 0, flipX: false, flipY: false, opacity: 1 },
			{ kind: "text", text: "hello <world>", x: 50, y: 60, opacity: 0.8 },
		], Uint8Array.of(0xff, 0xd8, 0xff, 0xd9));
		assert.equal(databaseFromPur(output).subarray(0, 16).toString(), new TextEncoder().encode("SQLite format 3\0").toString());
		const scene = await readPureRefScene(output);
		assert.equal(scene.images.length, 1);
		assert.equal(Buffer.from(scene.images[0].data).equals(png), true);
		assert.equal(scene.notes.length, 1);
		assert.match(scene.notes[0].html, /hello &lt;world&gt;/);
		const placement = scene.imageItems[0];
		const item = scene.items.find((entry) => entry.id === placement.id)!;
		const origin = transformPoint(item.transform, transformPoint(placement.imageTransform, { x: 0, y: 0 }));
		assert.deepEqual(origin, { x: 40, y: 80 });
	});

	it("keeps GIF bytes while encoding a cropped, flipped placement", async () => {
		const gif = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64");
		const output = await writePureRef2Scene([{ kind: "image", data: gif, format: "gif",
			sourceWidth: 1, sourceHeight: 1, crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
			x: 10, y: 20, width: 30, height: 40, angle: Math.PI / 4, flipX: true, flipY: false, opacity: 0.7,
		}], Uint8Array.of(0xff, 0xd8, 0xff, 0xd9));
		const scene = await readPureRefScene(output);
		assert.equal(scene.images[0].format, "gif");
		assert.equal(Buffer.from(scene.images[0].data).equals(gif), true);
		assert.equal(scene.items[0].opacity, 0.7);
		assert.equal(scene.imageItems[0].bounds.length, 5);
	});
});
