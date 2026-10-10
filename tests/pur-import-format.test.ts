import assert from "node:assert/strict";
import { it } from "node:test";
import { pureRefImageExtension, pureRefImageMime } from "../src/pur-import-format";

it("imports SVG through the native image path with the XML MIME type", () => {
	assert.equal(pureRefImageMime("svg"), "image/svg+xml");
	assert.equal(pureRefImageMime("SVG"), "image/svg+xml");
	assert.equal(pureRefImageExtension("SVG"), "svg");
});

it("keeps extended formats as original files for Obsidian embed renderers", () => {
	for (const format of ["TIFF", "tif", "tga", "dds", "hdr", "exr", "psd", "kra", "clip", "ai"]) {
		assert.equal(pureRefImageMime(format), null);
		assert.equal(pureRefImageExtension(format), format.toLowerCase());
	}
});

it("normalizes browser image aliases without making unknown formats fatal", () => {
	assert.equal(pureRefImageMime("JFIF"), "image/jpeg");
	assert.equal(pureRefImageExtension("jpeg"), "jpg");
	assert.equal(pureRefImageMime("apng"), "image/png");
	assert.equal(pureRefImageExtension("apng"), "png");
	assert.equal(pureRefImageMime("custom"), null);
	assert.equal(pureRefImageExtension("custom"), "custom");
	assert.equal(pureRefImageExtension("../../bad#format"), "bin");
});
