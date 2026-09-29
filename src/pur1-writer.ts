import { md5Hex } from "./md5";

/** A flattened PNG at its desired PureRef location, in PureRef pixels. */
export interface PureRefExportImage {
	png: Uint8Array;
	x: number;
	y: number;
	width: number;
	height: number;
	order?: number;
}

export interface PureRefExportText {
	text: string;
	x: number;
	y: number;
	fontSize: number;
	order?: number;
}

/** Keep image payloads as typed bytes instead of expanding them into JS numbers. */
class PurWriter {
	private readonly chunks: Uint8Array[] = [];
	length = 0;

	add(chunk: Uint8Array): void {
		this.chunks.push(chunk);
		this.length += chunk.length;
		if (!Number.isSafeInteger(this.length)) throw new Error("PureRef export is too large");
	}

	u32(value: number): void {
		const chunk = new Uint8Array(4);
		new DataView(chunk.buffer).setUint32(0, value, false);
		this.add(chunk);
	}

	u64(value: number): void {
		const chunk = new Uint8Array(8);
		new DataView(chunk.buffer).setBigUint64(0, BigInt(value), false);
		this.add(chunk);
	}

	f64(value: number): void {
		if (!Number.isFinite(value)) throw new Error("Invalid PureRef image geometry");
		const chunk = new Uint8Array(8);
		new DataView(chunk.buffer).setFloat64(0, value, false);
		this.add(chunk);
	}

	utf16(value: string): void {
		const chunk = new Uint8Array(value.length * 2);
		const view = new DataView(chunk.buffer);
		for (let i = 0; i < value.length; i++) view.setUint16(i * 2, value.charCodeAt(i), false);
		this.add(chunk);
	}

	string(value: string): void { this.u32(value.length * 2); this.utf16(value); }

	matrix(sx: number, sy: number): void {
		this.f64(sx); this.f64(0); this.f64(0);
		this.f64(0); this.f64(sy); this.f64(0);
	}

	finish(): Uint8Array {
		if (this.length > 0x7fffffff) throw new Error("PureRef export exceeds the supported file size");
		const result = new Uint8Array(this.length);
		let offset = 0;
		for (const chunk of this.chunks) { result.set(chunk, offset); offset += chunk.length; }
		return result;
	}
}

/** Write the flat 1.10 format used by PureRef 1.10/1.11 and its legacy export. */
export function writePureRef1Images(images: readonly PureRefExportImage[], notes: readonly PureRefExportText[] = []): Uint8Array {
	if (images.length + notes.length > 65535) throw new Error("PureRef 1.x supports at most 65535 items");
	const writer = new PurWriter();
	const header = new Uint8Array(224);
	const headerView = new DataView(header.buffer);
	const headerUtf16 = (at: number, value: string) => {
		for (let i = 0; i < value.length; i++) headerView.setUint16(at + i * 2, value.charCodeAt(i), false);
	};
	headerView.setUint32(0, 8, false);
	headerUtf16(4, "1.10");
	headerView.setUint16(12, images.length + notes.length, false);
	headerView.setUint16(14, images.length, false);
	headerView.setUint32(24, 12, false);
	headerView.setUint32(40, 64, false);
	headerView.setUint32(108, images.length + notes.length, false);
	[-10000, -10000, 10000, 10000].forEach((value, i) => headerView.setFloat64(112 + i * 8, value, false));
	headerView.setFloat64(144, 1, false);
	headerView.setFloat64(176, 1, false);
	headerView.setFloat64(208, 1, false);
	writer.add(header);

	const refs: Array<{ start: number; end: number }> = [];
	for (const image of images) {
		const signature = [137, 80, 78, 71, 13, 10, 26, 10];
		if (!signature.every((byte, i) => image.png[i] === byte)) throw new Error("PureRef 1.x export requires PNG images");
		if (![image.x, image.y, image.width, image.height].every(Number.isFinite) || image.width <= 0 || image.height <= 0) {
			throw new Error("Invalid PureRef image geometry");
		}
		const start = writer.length;
		writer.add(image.png);
		refs.push({ start, end: writer.length });
	}
	const itemEnds: Array<{ at: number; end: number }> = [];
	for (let id = 0; id < images.length; id++) {
		const image = images[id];
		const pngView = new DataView(image.png.buffer, image.png.byteOffset, image.png.byteLength);
		const width = pngView.getUint32(16, false), height = pngView.getUint32(20, false);
		if (!width || !height) throw new Error("Invalid export PNG dimensions");
		const recordAt = writer.length;
		writer.u64(0);
		writer.u32(34); writer.utf16("GraphicsImageItem");
		writer.u32(0); writer.string("BruteForceLoaded");
		writer.f64(1);
		writer.matrix(image.width / width, image.height / height);
		writer.f64(image.x + image.width / 2); writer.f64(image.y + image.height / 2); writer.f64(1);
		writer.u32(id); writer.f64(image.order ?? id + 1);
		writer.matrix(1, 1);
		writer.f64(-width / 2); writer.f64(-height / 2); writer.f64(1);
		writer.u32(5);
		const points = [[-width / 2, -height / 2], [width / 2, -height / 2],
			[width / 2, height / 2], [-width / 2, height / 2], [-width / 2, -height / 2]];
		points.forEach(([x, y], i) => { writer.u32(i === 0 ? 0 : 1); writer.f64(x); writer.f64(y); });
		writer.f64(0); writer.u32(1); writer.add(Uint8Array.of(0));
		writer.add(new Uint8Array(8).fill(255)); writer.u32(0);
		itemEnds.push({ at: recordAt, end: writer.length });
	}
	for (let index = 0; index < notes.length; index++) {
		const note = notes[index];
		if (![note.x, note.y, note.fontSize].every(Number.isFinite) || note.fontSize <= 0) throw new Error("Invalid PureRef text geometry");
		const recordAt = writer.length;
		writer.u64(0);
		writer.u32(32); writer.utf16("GraphicsTextItem");
		writer.string(note.text);
		// Legacy notes have an implicit 22 px Qt font. Scale their item matrix
		// together with the 4x coordinate conversion used by Board images.
		writer.matrix(note.fontSize * 4 / 22, note.fontSize * 4 / 22);
		writer.f64(note.x); writer.f64(note.y); writer.f64(1);
		writer.u32(images.length + index); writer.f64(note.order ?? images.length + index + 1);
		writer.add(Uint8Array.of(1));
		for (let i = 0; i < 4; i++) { writer.add(new Uint8Array(2).fill(255)); }
		writer.add(new Uint8Array(2)); writer.add(Uint8Array.of(1));
		writer.add(new Uint8Array(2));
		for (let i = 0; i < 3; i++) writer.add(new Uint8Array(2));
		writer.add(new Uint8Array(2)); writer.u32(0);
		itemEnds.push({ at: recordAt, end: writer.length });
	}
	writer.string("");
	headerView.setBigUint64(16, BigInt(writer.length), false);
	refs.forEach((ref, id) => { writer.u32(id); writer.u64(ref.start); writer.u64(ref.end); });
	const result = writer.finish();
	const view = new DataView(result.buffer);
	itemEnds.forEach(({ at, end }) => view.setBigUint64(at, BigInt(end), false));
	view.setBigUint64(16, BigInt(headerView.getBigUint64(16, false)), false);
	const checksum = md5Hex(result.subarray(108));
	for (let i = 0; i < checksum.length; i++) view.setUint16(44 + i * 2, checksum.charCodeAt(i), false);
	return result;
}
