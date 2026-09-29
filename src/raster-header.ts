/**
 * Formats PureRef 2.x stores as the untouched source file, keyed by vault file
 * extension. The value is the `images.format` string PureRef itself writes for
 * them (uppercase), observed in a PureRef 2.1 scene that imported each type.
 * EXR is deliberately absent: PureRef converts it to PNG on import.
 */
export const RAW_PUREREF_FORMATS: Readonly<Record<string, RawPureRefFormat>> = {
	tiff: "TIFF", tif: "TIFF", tga: "TGA", dds: "DDS", hdr: "HDR",
};

export type RawPureRefFormat = "TIFF" | "TGA" | "DDS" | "HDR";

export interface RasterSize {
	width: number;
	height: number;
}

function valid(width: number, height: number): RasterSize | null {
	return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? { width, height } : null;
}

function tiffSize(data: Uint8Array): RasterSize | null {
	if (data.length < 8) return null;
	const little = data[0] === 0x49 && data[1] === 0x49;
	if (!little && !(data[0] === 0x4d && data[1] === 0x4d)) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	if (view.getUint16(2, little) !== 42) return null; // BigTIFF (43) is not handled
	const ifd = view.getUint32(4, little);
	if (ifd + 2 > data.length) return null;
	const count = view.getUint16(ifd, little);
	let width = 0, height = 0;
	for (let i = 0; i < count; i++) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > data.length) return null;
		const tag = view.getUint16(entry, little), type = view.getUint16(entry + 2, little);
		if (tag !== 256 && tag !== 257) continue;
		const value = type === 3 ? view.getUint16(entry + 8, little) : type === 4 ? view.getUint32(entry + 8, little) : 0;
		if (tag === 256) width = value; else height = value;
	}
	return valid(width, height);
}

function tgaSize(data: Uint8Array): RasterSize | null {
	if (data.length < 18) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return valid(view.getUint16(12, true), view.getUint16(14, true));
}

function ddsSize(data: Uint8Array): RasterSize | null {
	if (data.length < 20 || String.fromCharCode(...data.subarray(0, 4)) !== "DDS ") return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return valid(view.getUint32(16, true), view.getUint32(12, true));
}

function hdrSize(data: Uint8Array): RasterSize | null {
	const head = String.fromCharCode(...data.subarray(0, Math.min(data.length, 4096)));
	if (!head.startsWith("#?")) return null;
	const blank = head.indexOf("\n\n");
	if (blank < 0) return null;
	const line = head.slice(blank + 2, head.indexOf("\n", blank + 2));
	const match = /^[+-]([XY]) (\d+) [+-]([XY]) (\d+)$/.exec(line);
	if (!match || match[1] === match[3]) return null;
	const first = Number(match[2]), second = Number(match[4]);
	return match[1] === "Y" ? valid(second, first) : valid(first, second);
}

/** Pixel size from a raw file's header, or null when the header is not recognized. */
export function rasterSize(format: RawPureRefFormat, data: Uint8Array): RasterSize | null {
	switch (format) {
		case "TIFF": return tiffSize(data);
		case "TGA": return tgaSize(data);
		case "DDS": return ddsSize(data);
		case "HDR": return hdrSize(data);
	}
}

/** Pixel size of a PNG from its IHDR chunk. */
export function pngSize(data: Uint8Array): RasterSize | null {
	if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return valid(view.getUint32(16, false), view.getUint32(20, false));
}
