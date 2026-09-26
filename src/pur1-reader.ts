import { createHash } from "crypto";
import type { Matrix, Point, PureRefScene } from "./pur2-reader";

/** PureRef 1.10's flat Qt stream (also written by PureRef 1.11.1). */
export function readPureRef1Scene(data: Uint8Array): PureRefScene {
	if (data.length < 224) throw new Error("PureRef 1.x file is too short");
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const check = (at: number, length: number): void => {
		if (!Number.isSafeInteger(at) || !Number.isSafeInteger(length) || at < 0 || length < 0 || at + length > data.length) {
			throw new Error("Invalid PureRef 1.x field length");
		}
	};
	const u16 = (at: number): number => { check(at, 2); return view.getUint16(at, false); };
	const u32 = (at: number): number => { check(at, 4); return view.getUint32(at, false); };
	const u64 = (at: number): number => {
		const value = u32(at) * 0x100000000 + u32(at + 4);
		if (!Number.isSafeInteger(value)) throw new Error("PureRef 1.x offset exceeds JavaScript's safe range");
		return value;
	};
	const f64 = (at: number): number => {
		check(at, 8);
		const value = view.getFloat64(at, false);
		if (!Number.isFinite(value)) throw new Error("Invalid PureRef 1.x coordinate");
		return value;
	};
	const utf16 = (at: number, length: number): string => {
		check(at, length);
		if (length % 2) throw new Error("Invalid PureRef 1.x UTF-16 length");
		let value = "";
		for (let i = at; i < at + length; i += 2) value += String.fromCharCode(u16(i));
		return value.replace(/\0+$/, "");
	};
	if (u32(0) !== 8 || utf16(4, 8) !== "1.10") throw new Error("Unsupported PureRef 1.x format version");
	// PureRef 2.x's "save as legacy" header uses a 10-byte version field
	// where the original 1.x writer uses 12; everything after byte 24 shifts
	// two bytes earlier, including the checksum and first PNG.
	const versionFieldBytes = u32(24);
	if (versionFieldBytes !== 10 && versionFieldBytes !== 12) throw new Error("Invalid PureRef 1.x header");
	const headerShift = versionFieldBytes - 12;
	const checksumAt = 44 + headerShift;
	if (utf16(checksumAt, 64) !== createHash("md5").update(data.subarray(108 + headerShift)).digest("hex")) {
		throw new Error("PureRef 1.x checksum mismatch");
	}
	const rootCount = u16(12);
	const imageCount = u16(14);
	const referenceStart = u64(16);
	if (imageCount > rootCount || referenceStart + imageCount * 20 !== data.length) {
		throw new Error("Invalid PureRef 1.x reference table");
	}
	const references = new Map<number, { start: number; end: number }>();
	let itemStart = 0;
	for (let i = 0; i < imageCount; i++) {
		const offset = referenceStart + i * 20;
		const id = u32(offset);
		const start = u64(offset + 4);
		const end = u64(offset + 12);
		if (start < 108 + headerShift || end <= start || end > referenceStart || references.has(id)) {
			throw new Error("Invalid PureRef 1.x image reference");
		}
		references.set(id, { start, end });
		itemStart = Math.max(itemStart, end);
	}
	const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
	const isPng = (at: number): boolean => pngSignature.every((byte, i) => data[at + i] === byte);
	type EmbeddedPng = { sourceId: number; data: Uint8Array; width: number; height: number };
	const pngById = new Map<number, EmbeddedPng>();
	const resolvePng = (id: number, visited = new Set<number>()): EmbeddedPng => {
		const cached = pngById.get(id);
		if (cached) return cached;
		if (visited.has(id)) throw new Error("Cyclic PureRef 1.x image reference");
		visited.add(id);
		const ref = references.get(id);
		if (!ref) throw new Error(`Missing PureRef 1.x image reference ${id}`);
		let image: EmbeddedPng;
		if (isPng(ref.start)) {
			if (ref.end - ref.start < 24) throw new Error("Truncated PureRef 1.x PNG");
			const width = u32(ref.start + 16), height = u32(ref.start + 20);
			if (!width || !height) throw new Error("Invalid PureRef 1.x PNG size");
			image = { sourceId: id, data: data.slice(ref.start, ref.end), width, height };
		} else if (ref.end - ref.start === 4 && u32(ref.start) !== 0xffffffff) {
			image = resolvePng(u32(ref.start), visited);
		} else {
			throw new Error(`PureRef 1.x image ${id} is linked externally and has no embedded media`);
		}
		pngById.set(id, image);
		return image;
	};
	const readMatrix = (at: number, x: number, y: number): Matrix => [
		f64(at), f64(at + 8), 0, f64(at + 24), f64(at + 32), 0, x, y, 1,
	];
	const readString = (at: number, limit: number): { value: string; next: number } => {
		const length = u32(at);
		if (at + 4 + length > limit) throw new Error("Invalid PureRef 1.x string length");
		return { value: utf16(at + 4, length), next: at + 4 + length };
	};
	const scene: PureRefScene = { items: [], images: [], imageItems: [], notes: [], groupIds: [], drawingCount: 0 };
	const seenIds = new Set<number>();
	const imageIds = new Set<number>();
	let cursor = itemStart;
	const readItem = (parent: number): void => {
		const end = u64(cursor);
		const type = u32(cursor + 8);
		const start = cursor;
		if ((type !== 32 && type !== 34) || end <= cursor + 12 + type || end > referenceStart) {
			throw new Error("Invalid PureRef 1.x item record");
		}
		cursor += 12 + type; // fixed UTF-16BE type name
		let text = "";
		if (type === 32) {
			const field = readString(cursor, end);
			text = field.value;
			cursor = field.next;
		} else {
			const bruteForce = u32(cursor) === 0;
			if (bruteForce) cursor += 4;
			if (u32(cursor) === 0xffffffff) cursor += 4;
			else cursor = readString(cursor, end).next;
			if (!bruteForce) {
				if (u32(cursor) === 0xffffffff) cursor += 4;
				else cursor = readString(cursor, end).next;
			}
		}
		if (type === 34) cursor += 8; // constant preceding the image matrix
		const matrixAt = cursor;
		cursor += 48;
		const x = f64(cursor), y = f64(cursor + 8);
		cursor += 24; // position and constant double
		const id = u32(cursor), z = f64(cursor + 4);
		cursor += 12;
		if (seenIds.has(id)) throw new Error(`Duplicate PureRef 1.x item ${id}`);
		seenIds.add(id);
		scene.items.push({ id, parent, z, opacity: 1, locked: false, transform: readMatrix(matrixAt, x, y) });
		if (type === 34) {
			const preCropAt = cursor;
			cursor += 48;
			const cropX = f64(cursor), cropY = f64(cursor + 8), cropScale = f64(cursor + 16);
			cursor += 24;
			const pointCount = u32(cursor);
			cursor += 4;
			if (pointCount < 4 || pointCount > 100000 || cursor + pointCount * 20 > end) {
				throw new Error("Invalid PureRef 1.x crop polygon");
			}
			const bounds: Point[] = [];
			for (let i = 0; i < pointCount; i++) {
				cursor += 4; // QPainterPath point type
				bounds.push({ x: f64(cursor), y: f64(cursor + 8) });
				cursor += 16;
			}
			const image = resolvePng(id);
			const pre = readMatrix(preCropAt, 0, 0);
			const imageTransform: Matrix = [
				pre[0] * cropScale, pre[1] * cropScale, 0,
				pre[3] * cropScale, pre[4] * cropScale, 0, cropX, cropY, 1,
			];
			if (!imageIds.has(image.sourceId)) {
				imageIds.add(image.sourceId);
				scene.images.push({ id: image.sourceId, format: "png", data: image.data, width: image.width, height: image.height });
			}
			scene.imageItems.push({ id, imageId: image.sourceId, imageTransform, bounds });
		} else {
			scene.notes.push({ id, html: text, backgroundColor: null });
		}
		if (cursor + (type === 34 ? 25 : 26) > end || end < start) throw new Error("PureRef 1.x item exceeds its record");
		// PureRef 2.x's legacy exporter may append more fields after this count.
		const children = u32(type === 34 ? cursor + 21 : cursor + 22);
		cursor = end;
		if (children > 100000) throw new Error("Too many PureRef 1.x child items");
		for (let i = 0; i < children; i++) readItem(id);
	};
	for (let i = 0; i < rootCount; i++) readItem(-1);
	if (scene.imageItems.length !== imageCount) throw new Error("PureRef 1.x image count does not match its header");
	const folder = readString(cursor, referenceStart);
	if (folder.next !== referenceStart) throw new Error("Invalid PureRef 1.x trailing data");
	return scene;
}
