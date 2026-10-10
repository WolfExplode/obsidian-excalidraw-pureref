import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeImageDataURL, externalImageExportName, resolveImageExportSource } from "../src/media-export-source";

test("linked images without a vault file remain exportable", () => {
	const pixels = "data:image/png;base64,AAH/";
	assert.deepEqual(resolveImageExportSource({ file: null, hyperlink: "https://example.com/photo.png" }, pixels), {
		kind: "external", url: "https://example.com/photo.png", dataURL: pixels,
	});
	assert.equal(resolveImageExportSource({ hyperlink: "file:///C:/References/photo.png" }, undefined)?.kind, "external");
	assert.equal(resolveImageExportSource({ getImage: () => pixels }, undefined)?.kind, "external");
	assert.equal(resolveImageExportSource(undefined, undefined), null);
});

test("vault files retain their original copy source and core pixels take precedence", () => {
	const file = { path: "images/photo.png" };
	assert.deepEqual(resolveImageExportSource({ file, getImage: () => "stale" }, "loaded"), {
		kind: "vault", file, dataURL: "loaded",
	});
});

test("cached image decoding preserves binary bytes and supports encoded SVG", () => {
	assert.deepEqual([...decodeImageDataURL("data:image/png;base64,AAH/").bytes], [0, 1, 255]);
	const svg = '<svg xmlns="http://www.w3.org/2000/svg">é</svg>';
	const decoded = decodeImageDataURL(`data:image/svg+xml,${encodeURIComponent(svg)}`);
	assert.equal(decoded.mimeType, "image/svg+xml");
	assert.equal(new TextDecoder().decode(decoded.bytes), svg);
	assert.throws(() => decodeImageDataURL("https://example.com/photo.png"));
});

test("external filenames omit URL tokens, stay within the destination, and use MIME fallbacks", () => {
	assert.equal(externalImageExportName("https://example.com/photo%20one.png?token=secret#part", "image/png", "abc"), "photo one.png");
	assert.equal(externalImageExportName("file:///C:/Images/photo.jpg", "image/jpeg", "abc"), "photo.jpg");
	assert.equal(externalImageExportName("https://example.com/download?token=secret", "image/webp", "abc"), "download.webp");
	assert.equal(externalImageExportName(undefined, "image/png", "abc"), "image-abc.png");
	assert.equal(externalImageExportName("https://example.com/%2E%2E%2Fphoto.png", "image/png", "abc"), ".._photo.png");
	assert.equal(externalImageExportName("https://example.com/CON", "image/png", "abc"), "image-abc.png");
});
