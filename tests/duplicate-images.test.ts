import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectedImagesWithDuplicates, selectedDuplicateImageIdsToDelete, type DuplicateImageCandidate } from "../src/duplicate-images";

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

describe("Delete duplicate images", () => {
	const remove = (elements: DuplicateImageCandidate[], selected = elements.map(element => element.id), crops = true) =>
		selectedDuplicateImageIdsToDelete(elements, Object.fromEntries(selected.map(id => [id, true])), cropKey, crops);

	it("keeps one image per repeated source and preserves unique images", () => {
		assert.deepEqual(remove([image("a", "A"), image("b", "B"), image("a2", "A"), image("unique", "C"),
			image("b2", "B"), image("a3", "A")]), ["a2", "b2", "a3"]);
	});
	it("keeps the first selected copy in Board order, regardless of selection key order", () => {
		assert.deepEqual(remove([image("a", "A"), image("a2", "A"), image("a3", "A")], ["a3", "a2", "a"]), ["a2", "a3"]);
	});
	it("does not count or remove copies outside the selection", () => {
		assert.deepEqual(remove([image("outside", "A"), image("keep", "A"), image("remove", "A")], ["keep", "remove"]), ["remove"]);
		assert.deepEqual(remove([image("outside", "A"), image("keep", "A")], ["keep"]), []);
	});
	it("ignores deleted copies, missing identities, other types, and false selection entries", () => {
		const elements = [{ ...image("deleted", "A"), isDeleted: true }, image("keep", "A"), image("remove", "A"),
			image("unknown"), image("unknown2"), { ...image("shape", "A"), type: "rectangle" }];
		assert.deepEqual(remove(elements), ["remove"]);
		assert.deepEqual(selectedDuplicateImageIdsToDelete(elements, { keep: true, remove: false }, cropKey, true), []);
	});
	it("uses the existing source policy for native and generated crops", () => {
		const elements = [image("original", "A"), { ...image("native", "A"), crop: { width: 5, height: 10 } },
			{ ...image("custom", "generated"), customData: { [cropKey]: { sourceFileId: "A" } } }];
		assert.deepEqual(remove(elements), ["native", "custom"]);
		assert.deepEqual(remove(elements, undefined, false), []);
	});
	it("makes an empty or all-unique selection a no-op", () => {
		assert.deepEqual(remove([]), []);
		assert.deepEqual(remove([image("a", "A"), image("b", "B")]), []);
	});
});
