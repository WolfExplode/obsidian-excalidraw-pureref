import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isLodImageVisible, isJpegProxySource, hasImageNavigationSupport } from "../src/image-lod-policy";

test("JPEG proxy eligibility checks bytes as well as the MIME label", () => {
	assert.equal(isJpegProxySource("data:image/jpeg;base64,/9j/4AAQ"), true);
	assert.equal(isJpegProxySource("data:image/jfif;base64,/9j/4AAQ"), true);
	assert.equal(isJpegProxySource("data:image/jpg;base64,/9j/4AAQ"), true);
	assert.equal(isJpegProxySource("data:image/pjpeg;base64,/9j/4AAQ"), true);
	assert.equal(isJpegProxySource("data:image/jpeg;base64,UklGRgBHAABX"), false);
	assert.equal(isJpegProxySource("data:image/png;base64,iVBORw0KGgo"), false);
	assert.equal(isJpegProxySource("data:image/jpeg;base64,"), false);
});

test("image navigation requires both renderer callbacks and rejects partial or malformed support", () => {
	assert.equal(hasImageNavigationSupport(null), false);
	assert.equal(hasImageNavigationSupport({}), false);
	assert.equal(hasImageNavigationSupport({ setImageRenderSourceProvider: () => {} }), false);
	assert.equal(hasImageNavigationSupport({ setImageRenderSourceProvider: true, refreshImageRenderSources: () => {} }), false);
	assert.equal(hasImageNavigationSupport({ setImageRenderSourceProvider: () => {}, refreshImageRenderSources: () => {} }), true);
});

test("culling uses scroll, zoom, and conservative rotated bounds", () => {
	const view = { scrollX: 0, scrollY: 0, width: 100, height: 100, zoom: { value: 1 } };
	const image = { x: 110, y: 0, width: 10, height: 100 };
	assert.equal(isLodImageVisible(image, view), false);
	assert.equal(isLodImageVisible({ ...image, angle: Math.PI / 2 }, view), true);
	assert.equal(isLodImageVisible(image, { ...view, scrollX: -100 }), true);
	assert.equal(isLodImageVisible(image, { ...view, zoom: { value: 0.5 } }), true);
});
