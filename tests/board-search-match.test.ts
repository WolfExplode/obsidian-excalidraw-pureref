import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchBoardMetadata, type BoardSearchCandidate } from "../src/board-search-match";

const candidates: BoardSearchCandidate[] = [
	{ id: "jpg", type: "image", path: "References/Mountain.JPG", mimeType: "image/jpeg" },
	{ id: "png", type: "image", path: "References/Forest.png", mimeType: "image/png" },
	{ id: "video", type: "embeddable", link: "[[Videos/Walk.mp4|Walk]]" },
	{ id: "remote", type: "image", hyperlink: "https://example.com/City%20Street.jpeg", mimeType: "image/jpeg" },
	{ id: "binary", type: "image", mimeType: "image/jpeg", hyperlink: "data:image/jpeg;base64,unsearchable" },
	{ id: "deleted", type: "image", path: "removed.jpg", isDeleted: true },
	{ id: "shape", type: "rectangle", link: "https://example.com/reference" },
];
const ids = (query: string) => matchBoardMetadata(candidates, query).map(match => match.id);

describe("Board metadata search", () => {
	it("finds JPEG sources case-insensitively, including binaries with no filename", () => {
		assert.deepEqual(ids(" .JPG "), ["jpg", "remote", "binary"]);
	});
	it("searches filenames, folders, embeds, URLs, and element types", () => {
		assert.deepEqual(ids("mountain"), ["jpg"]);
		assert.deepEqual(ids("references/"), ["jpg", "png"]);
		assert.deepEqual(ids(".mp4"), ["video"]);
		assert.deepEqual(ids("City Street"), ["remote"]);
		assert.deepEqual(ids("rectangle"), ["shape"]);
	});
	it("never searches image bytes or returns deleted/empty matches", () => {
		assert.deepEqual(ids("unsearchable"), []);
		assert.deepEqual(ids("removed"), []);
		assert.deepEqual(ids("  "), []);
	});
	it("handles malformed URI escapes and treats queries literally", () => {
		assert.deepEqual(matchBoardMetadata([{ id: "odd", type: "image", path: "100%[a].png" }], "%[a]")
			.map(match => match.id), ["odd"]);
	});
	it("matches every attachment replacement in either direction", () => {
		for (const [ascii, wide] of [["#", "＃"], ["^", "＾"], ["[", "［"], ["]", "］"], ["|", "｜"]]) {
			const files: BoardSearchCandidate[] = [
				{ id: "original", type: "image", path: `References/photo${ascii}tag.jpg` },
				{ id: "renamed", type: "image", path: `References/photo${wide}tag.jpg` },
			];
			for (const query of [ascii, wide]) {
				assert.deepEqual(matchBoardMetadata(files, query).map(match => match.id), ["original", "renamed"]);
			}
		}
	});
	it("finds an ASCII tag in renamed paths, embeds, and encoded URLs without changing labels", () => {
		const files: BoardSearchCandidate[] = [
			{ id: "path", type: "image", path: "References/product-401931 ［AI］.webp" },
			{ id: "embed", type: "embeddable", link: "[[References/［Ai］.mp4]]" },
			{ id: "url", type: "image", hyperlink: `https://example.com/${encodeURIComponent("［AI］")}.jpg` },
			{ id: "other", type: "image", path: "References/AIR.jpg" },
		];
		for (const query of ["[AI]", "［ai］", "[Ai］"]) {
			const matches = matchBoardMetadata(files, query);
			assert.deepEqual(matches.map(match => match.id), ["path", "embed", "url"]);
			assert.equal(matches[0].label, files[0].path);
		}
	});
	it("folds renamed characters even when a filename contains malformed URI escapes", () => {
		assert.deepEqual(matchBoardMetadata([{ id: "odd", type: "image", path: "100% ［AI］.jpg" }], "[AI]")
			.map(match => match.id), ["odd"]);
	});
});
