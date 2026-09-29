import { md5Hex } from "./md5";
import initSqlJs from "sql.js/dist/sql-asm-memory-growth.js";

export interface PureRef2Image {
	kind: "image";
	data: Uint8Array;
	format: "png" | "jpg" | "gif";
	sourceWidth: number;
	sourceHeight: number;
	crop: { x: number; y: number; width: number; height: number };
	x: number;
	y: number;
	width: number;
	height: number;
	angle: number;
	flipX: boolean;
	flipY: boolean;
	opacity: number;
}

export interface PureRef2Text {
	kind: "text";
	text: string;
	fontSize: number;
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
}

export type PureRef2Item = PureRef2Image | PureRef2Text;

interface SqlDatabase {
	run(sql: string, params?: Array<string | number | Uint8Array | null>): void;
	exec(sql: string): Array<{ values: Array<Array<string | number | Uint8Array | null>> }>;
	export(): Uint8Array;
	close(): void;
}

let sqlPromise: Promise<{ Database: new () => SqlDatabase }> | null = null;
const NOTE_FONT_SIZE_PX = 12;

/** PureRef stores Qt streams as Latin-1 code points encoded in SQLite TEXT. */
function qtTextBytes(raw: Uint8Array): Uint8Array {
	let text = "";
	for (const byte of raw) text += String.fromCharCode(byte);
	return new TextEncoder().encode(text);
}

function doubles(tag: number, values: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(5 + values.length * 8);
	bytes[3] = tag;
	const view = new DataView(bytes.buffer);
	values.forEach((value, i) => view.setFloat64(5 + i * 8, value, false));
	return bytes;
}

function matrix(a: number, b: number, d: number, e: number, x: number, y: number): Uint8Array {
	return doubles(0x50, [a, b, 0, d, e, 0, x, y, 1]);
}

function painterPath(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(8 + 1 + 13 + 4 + 5 * 20 + 8);
	bytes[2] = 4;
	bytes[8] = 13;
	bytes.set(new TextEncoder().encode("QPainterPath\0"), 9);
	const view = new DataView(bytes.buffer);
	view.setUint32(22, 5, false);
	const points = [[-width / 2, -height / 2], [width / 2, -height / 2],
		[width / 2, height / 2], [-width / 2, height / 2], [-width / 2, -height / 2]];
	points.forEach(([x, y], i) => {
		const at = 26 + i * 20;
		view.setUint32(at, i === 0 ? 0 : 1, false);
		view.setFloat64(at + 4, x, false);
		view.setFloat64(at + 12, y, false);
	});
	return bytes;
}

function sortOrder(position: number): Uint8Array {
	const hex = "00000400000000000c426967526174696f6e616c000000000100000000000000010000000100000001000000000000000100000001";
	const bytes = Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
	new DataView(bytes.buffer).setUint32(33, position, false);
	return bytes;
}

function html(text: string): string {
	const safe = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0//EN" "http://www.w3.org/TR/REC-html40/strict.dtd">\n` +
		`<html><head><meta name="qrichtext" content="1" /><meta charset="utf-8" /></head>` +
		`<body style="font-family:'Open Sans'; font-size:22px;"><p><span style="font-size:${NOTE_FONT_SIZE_PX}px;">${safe.replace(/\n/g, "<br />")}</span></p></body></html>`;
}

const SCHEMA = [
	"CREATE TABLE images (id INTEGER PRIMARY KEY,source_type INTEGER,origin TEXT,source TEXT,format TEXT,checksum TEXT,data BLOB,width INTEGER,height INTEGER)",
	"CREATE TABLE metadata (id INTEGER PRIMARY KEY,scene_rect TEXT,application_version TEXT,view_transform TEXT,thumbnail BLOB,horizontal_scroll INTEGER,vertical_scroll INTEGER,last_save_path TEXT,last_load_path TEXT,last_load_checksum TEXT,saved INTEGER)",
	"CREATE TABLE items (parent INTEGER,id INTEGER PRIMARY KEY,name TEXT,transform BLOB,sort_order BLOB,z REAL,opacity REAL,locked INTEGER,comment INTEGER)",
	"CREATE TABLE items_images (image INTEGER,playback_speed REAL,id INTEGER PRIMARY KEY,playback_state INTEGER,image_transform BLOB,image_bounds BLOB,playback_frame INTEGER,flags INTEGER)",
	"CREATE TABLE items_drawings (id INTEGER PRIMARY KEY,strokes BLOB)",
	"CREATE TABLE items_notes (text_color TEXT,id INTEGER PRIMARY KEY,fixed_size TEXT,background_color TEXT,text TEXT,style INTEGER)",
	"CREATE TABLE items_groups (id INTEGER PRIMARY KEY,background_color TEXT,lock_mode INTEGER)",
];

/** Build the PureRef 2.x rotated-SQLite container from image and note placements. */
export async function writePureRef2Scene(items: readonly PureRef2Item[], thumbnail: Uint8Array): Promise<Uint8Array> {
	if (thumbnail[0] !== 0xff || thumbnail[1] !== 0xd8) throw new Error("PureRef thumbnail must be JPEG");
	if (items.length === 0) throw new Error("No exportable images or text on this Board");
	if (items.length > 0xffffffff) throw new Error("Too many PureRef items");
	sqlPromise ??= initSqlJs() as Promise<{ Database: new () => SqlDatabase }>;
	const SQL = await sqlPromise;
	const db = new SQL.Database();
	let database: Uint8Array;
	try {
		db.run("PRAGMA page_size=4096");
		for (const statement of SCHEMA) db.run(statement);
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		items.forEach((item, id) => {
			if (![item.x, item.y, item.opacity].every(Number.isFinite)) throw new Error("Invalid PureRef item geometry");
			if (item.kind === "image") {
				const { sourceWidth, sourceHeight, crop, width, height, angle } = item;
				if (![sourceWidth, sourceHeight, crop.x, crop.y, crop.width, crop.height, width, height, angle].every(Number.isFinite)
					|| sourceWidth <= 0 || sourceHeight <= 0 || crop.width <= 0 || crop.height <= 0 || width <= 0 || height <= 0) {
					throw new Error("Invalid PureRef image geometry");
				}
				const W = width * 4, H = height * 4;
				const cx = (item.x + width / 2) * 4, cy = (item.y + height / 2) * 4;
				const cosine = Math.cos(angle), sine = Math.sin(angle);
				const boundsWidth = Math.abs(W * cosine) + Math.abs(H * sine);
				const boundsHeight = Math.abs(W * sine) + Math.abs(H * cosine);
				minX = Math.min(minX, cx - boundsWidth / 2); minY = Math.min(minY, cy - boundsHeight / 2);
				maxX = Math.max(maxX, cx + boundsWidth / 2); maxY = Math.max(maxY, cy + boundsHeight / 2);
				const sx = (item.flipX ? -1 : 1) * W / crop.width;
				const sy = (item.flipY ? -1 : 1) * H / crop.height;
				const tx = -crop.x - crop.width / 2;
				const ty = -crop.y - crop.height / 2;
				db.run("INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?)", [id, 1, "", "", item.format,
					md5Hex(item.data), item.data, sourceWidth, sourceHeight]);
				db.run("INSERT INTO items VALUES (?,?,?,CAST(? AS TEXT),CAST(? AS TEXT),?,?,?,?)", [-1, id, null,
					qtTextBytes(matrix(cosine * sx, sine * sx, -sine * sy, cosine * sy, cx, cy)), qtTextBytes(sortOrder(id + 1)), id + 1,
					Math.max(0, Math.min(1, item.opacity)), 0, null]);
				db.run("INSERT INTO items_images VALUES (?,?,?,?,CAST(? AS TEXT),CAST(? AS TEXT),?,?)", [id, 1, id,
					item.format === "gif" ? 3 : 0, qtTextBytes(matrix(1, 0, 0, 1, tx, ty)), qtTextBytes(painterPath(crop.width, crop.height)), 0, 1]);
			} else {
				if (![item.fontSize, item.width, item.height].every(Number.isFinite)
					|| item.fontSize <= 0 || item.width <= 0 || item.height <= 0) throw new Error("Invalid PureRef text size");
				// Export text at half its Board size. PureRef positions a note around
				// its transform origin, so center the smaller box at one quarter of
				// the original width and height from Excalidraw's top-left.
				const x = (item.x + item.width / 4) * 4, y = (item.y + item.height / 4) * 4;
				const textScale = item.fontSize * 2 / NOTE_FONT_SIZE_PX;
				minX = Math.min(minX, item.x * 4); minY = Math.min(minY, item.y * 4);
				maxX = Math.max(maxX, (item.x + item.width / 2) * 4);
				maxY = Math.max(maxY, (item.y + item.height / 2) * 4);
				db.run("INSERT INTO items VALUES (?,?,?,CAST(? AS TEXT),CAST(? AS TEXT),?,?,?,?)", [-1, id, null,
					qtTextBytes(matrix(textScale, 0, 0, textScale, x, y)), qtTextBytes(sortOrder(id + 1)), id + 1,
					Math.max(0, Math.min(1, item.opacity)), 0, null]);
				db.run("INSERT INTO items_notes VALUES (?,?,CAST(? AS TEXT),?,?,?)", [null, id,
					qtTextBytes(doubles(0x16, [-1, -1])), "#d9ffffff", html(item.text), 1]);
			}
		});
		db.run("INSERT INTO metadata VALUES (?,CAST(? AS TEXT),?,CAST(? AS TEXT),?,?,?,?,?,?,?)", [0,
			qtTextBytes(doubles(0x14, [minX, minY, maxX - minX, maxY - minY])), "2.0.3",
			qtTextBytes(matrix(1, 0, 0, 1, 0, 0)), thumbnail, 0, 0, "", "", null, 1]);
		if (db.exec("PRAGMA integrity_check")[0]?.values[0]?.[0] !== "ok") throw new Error("PureRef database integrity check failed");
		database = db.export();
	} finally {
		db.close();
	}
	const frontSize = 108 + thumbnail.length;
	if (frontSize > database.length) throw new Error("PureRef thumbnail is larger than the database header rotation");
	const output = new Uint8Array(108 + thumbnail.length + database.length);
	const view = new DataView(output.buffer);
	view.setUint32(0, 6, false);
	const putUtf16 = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint16(at + i * 2, value.charCodeAt(i), false); };
	putUtf16(4, "2.1");
	view.setBigUint64(14, BigInt(database.length), false);
	view.setUint32(22, 10, false);
	putUtf16(26, "2.0.3");
	view.setUint32(36, 64, false);
	view.setUint32(104, thumbnail.length, false);
	output.set(thumbnail, 108);
	output.set(database.subarray(frontSize), frontSize);
	output.set(database.subarray(0, frontSize), database.length);
	putUtf16(40, md5Hex(output.subarray(104)));
	return output;
}
