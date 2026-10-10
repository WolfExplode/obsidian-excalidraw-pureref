import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectedImagesWithDuplicates, type DuplicateImageCandidate } from "../src/duplicate-images";

const cropKey = "crop";
const image = (id: string, fileId?: string): DuplicateImageCandidate => ({ id, type: "image", fileId });
const filter = (elements: DuplicateImageCandidate[], selected = elements.map(element => element.id), crops = true) =>
	selectedImagesWithDuplicates(elements, Object.fromEntries(selected.map(id => [id, true])), cropKey, crops);

describe("Select images with duplicates", () => {
	it("keeps all copies from every repeated source and removes unique images", () => {
		assert.deepEqual(filter([image("a", "A"), image("b", "B"), image("a2", "A"), image("c", "C"),
			image("b2", "B"), image("a3", "A")]), ["a", "b", "a2", "b2", "a3"]);
	});
	it("counts duplicates only inside the selection", () => {
		assert.deepEqual(filter([image("a", "A"), image("a2", "A"), image("b", "B")], ["a", "b"]), []);
	});
	it("clears all-unique selections and leaves all-duplicate selections intact", () => {
		assert.deepEqual(filter([image("a", "A"), image("b", "B")]), []);
		assert.deepEqual(filter([image("a", "A"), image("a2", "A")]), ["a", "a2"]);
	});
	it("ignores deleted images, missing file identities, and other element types", () => {
		assert.deepEqual(filter([image("a", "A"), { ...image("deleted", "A"), isDeleted: true },
			image("unknown"), image("unknown2"), { ...image("shape", "A"), type: "rectangle" }]), []);
	});
	it("treats native and custom crops as copies of their source", () => {
		assert.deepEqual(filter([image("original", "A"), { ...image("native", "A"), crop: { width: 5, height: 10 } },
			{ ...image("custom", "generated"), customData: { [cropKey]: { sourceFileId: "A" } } }]), ["original", "native", "custom"]);
	});
	it("respects the shared crop policy when crops should be distinct", () => {
		assert.deepEqual(filter([image("original", "A"), { ...image("native", "A"), crop: { width: 5, height: 10 } },
			{ ...image("custom", "generated"), customData: { [cropKey]: { sourceFileId: "A" } } }], undefined, false), []);
	});
});
