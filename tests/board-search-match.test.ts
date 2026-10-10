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
});
