import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pngSize, rasterSize } from "../src/raster-header";

function tiff(little: boolean, widthType: 3 | 4): Uint8Array {
	const bytes = new Uint8Array(8 + 2 + 3 * 12 + 4);
	const view = new DataView(bytes.buffer);
	bytes.set(little ? [0x49, 0x49] : [0x4d, 0x4d]);
	view.setUint16(2, 42, little);
	view.setUint32(4, 8, little);
	view.setUint16(8, 3, little);
	const entry = (i: number, tag: number, type: number, value: number) => {
		const at = 10 + i * 12;
		view.setUint16(at, tag, little); view.setUint16(at + 2, type, little); view.setUint32(at + 4, 1, little);
		if (type === 3) view.setUint16(at + 8, value, little); else view.setUint32(at + 8, value, little);
	};
	entry(0, 254, 4, 0);
	entry(1, 256, widthType, 157);
	entry(2, 257, 3, 151);
	return bytes;
}

describe("rasterSize", () => {
	it("reads TIFF width and height in both byte orders and value types", () => {
		assert.deepEqual(rasterSize("TIFF", tiff(true, 3)), { width: 157, height: 151 });
		assert.deepEqual(rasterSize("TIFF", tiff(false, 4)), { width: 157, height: 151 });
	});

	it("reads TGA and DDS headers", () => {
		const tga = new Uint8Array(18);
		new DataView(tga.buffer).setUint16(12, 512, true);
		new DataView(tga.buffer).setUint16(14, 256, true);
		assert.deepEqual(rasterSize("TGA", tga), { width: 512, height: 256 });
		const dds = new Uint8Array(128);
		dds.set([0x44, 0x44, 0x53, 0x20]);
		new DataView(dds.buffer).setUint32(12, 2000, true); // height precedes width
		new DataView(dds.buffer).setUint32(16, 3500, true);
		assert.deepEqual(rasterSize("DDS", dds), { width: 3500, height: 2000 });
	});

	it("reads the Radiance resolution line after the header", () => {
		const hdr = (res: string) => new TextEncoder().encode(`#?RADIANCE\n# Made with test\nFORMAT=32-bit_rle_rgbe\n\n${res}\n\x02\x02`);
		assert.deepEqual(rasterSize("HDR", hdr("-Y 512 +X 1024")), { width: 1024, height: 512 });
		assert.deepEqual(rasterSize("HDR", hdr("+X 300 -Y 200")), { width: 300, height: 200 });
	});

	it("rejects unrecognized headers", () => {
		assert.equal(rasterSize("DDS", new Uint8Array(128)), null);
		assert.equal(rasterSize("TIFF", new Uint8Array(16)), null);
		assert.equal(rasterSize("HDR", new TextEncoder().encode("#?RADIANCE\nno blank line")), null);
		assert.equal(rasterSize("TGA", new Uint8Array(18)), null);
	});
});

describe("pngSize", () => {
	it("reads IHDR dimensions", () => {
		const png = new Uint8Array(24);
		png.set([0x89, 0x50, 0x4e, 0x47]);
		new DataView(png.buffer).setUint32(16, 4000);
		new DataView(png.buffer).setUint32(20, 2000);
		assert.deepEqual(pngSize(png), { width: 4000, height: 2000 });
	});
});
