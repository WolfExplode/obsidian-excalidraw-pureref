import { createHash } from "crypto";
import initSqlJs from "sql.js/dist/sql-asm-memory-growth.js";

export type Point = { x: number; y: number };
export type Matrix = [number, number, number, number, number, number, number, number, number];

export interface PureRefItem {
	id: number;
	parent: number;
	z: number;
	opacity: number;
	locked: boolean;
	transform: Matrix;
}

export interface PureRefImage {
	id: number;
	format: string;
	data: Uint8Array;
	width: number;
	height: number;
}

export interface PureRefImageItem {
	id: number;
	imageId: number;
	imageTransform: Matrix;
	bounds: Point[];
}

export interface PureRefNote {
	id: number;
	html: string;
	backgroundColor: string | null;
}

export interface PureRefScene {
	items: PureRefItem[];
	images: PureRefImage[];
	imageItems: PureRefImageItem[];
	notes: PureRefNote[];
	groupIds: number[];
	drawingCount: number;
}

type SqlValue = string | number | Uint8Array | null;
interface SqlDatabase {
	exec(sql: string): Array<{ columns: string[]; values: SqlValue[][] }>;
	close(): void;
}

function query(db: SqlDatabase, sql: string): Record<string, SqlValue>[] {
	const result = db.exec(sql)[0];
	return result ? result.values.map((values) => Object.fromEntries(result.columns.map((key, i) => [key, values[i]]))) : [];
}

function number(value: SqlValue, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${name} in PureRef database`);
	return value;
}

function bytes(value: SqlValue, name: string): Uint8Array {
	if (!(value instanceof Uint8Array)) throw new Error(`Invalid ${name} in PureRef database`);
	return value;
}

function qtBytes(value: SqlValue, name: string): Uint8Array {
	// sql.js truncates TEXT at embedded NUL. CAST(column AS BLOB) in the query
	// preserves its UTF-8 bytes; decode that wrapper before reversing it.
	if (value instanceof Uint8Array) value = new TextDecoder("utf-8", { fatal: true }).decode(value);
	if (typeof value !== "string") throw new Error(`Invalid ${name} in PureRef database`);
	const result = new Uint8Array(value.length);
	for (let i = 0; i < value.length; i++) {
		const point = value.charCodeAt(i);
		if (point > 255) throw new Error(`Invalid ${name} Qt byte wrapper`);
		result[i] = point;
	}
	return result;
}

function matrix(value: SqlValue, name: string): Matrix {
	const raw = qtBytes(value, name);
	if (raw.length !== 77 || raw[0] !== 0 || raw[1] !== 0 || raw[2] !== 0 || raw[3] !== 0x50 || raw[4] !== 0) {
		throw new Error(`Unrecognized ${name} transform`);
	}
	const view = new DataView(raw.buffer);
	return Array.from({ length: 9 }, (_, i) => view.getFloat64(5 + 8 * i, false)) as Matrix;
}

function painterPath(value: SqlValue): Point[] {
	const raw = qtBytes(value, "image bounds");
	const tag = new TextDecoder().decode(raw.slice(9, 9 + raw[8]));
	if (raw.length < 25 || raw[2] !== 4 || tag !== "QPainterPath\0") throw new Error("Unrecognized PureRef image bounds");
	const view = new DataView(raw.buffer);
	const countOffset = 9 + raw[8];
	const count = view.getUint32(countOffset, false);
	const start = countOffset + 4;
	if (count > 100000 || raw.length !== start + count * 20 + 8) throw new Error("Invalid PureRef image bounds length");
	const points: Point[] = [];
	for (let i = 0; i < count; i++) {
		const offset = start + i * 20;
		points.push({ x: view.getFloat64(offset + 4, false), y: view.getFloat64(offset + 12, false) });
	}
	return points;
}

function readUtf16Be(data: Uint8Array, start: number, length: number): string {
	let result = "";
	for (let i = start; i < start + length; i += 2) result += String.fromCharCode((data[i] << 8) | data[i + 1]);
	return result.replace(/\0+$/, "");
}

export function databaseFromPur(data: Uint8Array): Uint8Array {
	if (data.length < 124) throw new Error("PureRef file is too short");
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	if (view.getUint32(0, false) !== 6 || readUtf16Be(data, 4, 8) !== "2.1") {
		throw new Error("This importer supports PureRef 2.0/2.1 scenes only");
	}
	const thumbnailBytes = view.getUint32(104, false);
	const frontSize = 108 + thumbnailBytes;
	const databaseSize = data.length - frontSize;
	if (frontSize >= data.length || view.getUint32(14, false) !== 0 || view.getUint32(18, false) !== databaseSize) {
		throw new Error("Invalid PureRef database length");
	}
	const checksum = readUtf16Be(data, 40, 64);
	if (createHash("md5").update(data.subarray(104)).digest("hex") !== checksum) throw new Error("PureRef checksum mismatch");
	if (new TextDecoder().decode(data.subarray(databaseSize, databaseSize + 16)) !== "SQLite format 3\0") {
		throw new Error("PureRef SQLite header is missing");
	}
	const database = new Uint8Array(databaseSize);
	database.set(data.subarray(databaseSize), 0);
	database.set(data.subarray(frontSize, databaseSize), frontSize);
	const dbView = new DataView(database.buffer);
	const pageSize = dbView.getUint16(16, false) || 65536;
	if (pageSize * dbView.getUint32(28, false) !== databaseSize) throw new Error("Invalid PureRef SQLite page count");
	return database;
}

let sqlPromise: Promise<{ Database: new (data: Uint8Array) => SqlDatabase }> | null = null;

export async function readPureRefScene(data: Uint8Array): Promise<PureRefScene> {
	const databaseBytes = databaseFromPur(data);
	sqlPromise ??= initSqlJs() as Promise<{ Database: new (data: Uint8Array) => SqlDatabase }>;
	const SQL = await sqlPromise;
	const db = new SQL.Database(databaseBytes);
	try {
		const integrity = query(db, "PRAGMA integrity_check");
		if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") throw new Error("PureRef SQLite integrity check failed");
		const items = query(db, "SELECT id,parent,z,opacity,locked,CAST(transform AS BLOB) AS transform FROM items").map((row) => ({
			id: number(row.id, "item ID"), parent: number(row.parent, "item parent"),
			z: number(row.z, "item Z"), opacity: number(row.opacity, "item opacity"),
			locked: Boolean(row.locked), transform: matrix(row.transform, "item"),
		}));
		const images = query(db, "SELECT id,format,checksum,data,width,height FROM images").map((row) => {
			const data = bytes(row.data, "image data");
			if (createHash("md5").update(data).digest("hex") !== row.checksum) throw new Error(`Image ${row.id} checksum mismatch`);
			return { id: number(row.id, "image ID"), format: String(row.format).toLowerCase(), data,
				width: number(row.width, "image width"), height: number(row.height, "image height") };
		});
		const imageItems = query(db, "SELECT id,image,CAST(image_transform AS BLOB) AS image_transform,CAST(image_bounds AS BLOB) AS image_bounds FROM items_images").map((row) => ({
			id: number(row.id, "image item ID"), imageId: number(row.image, "image reference"),
			imageTransform: matrix(row.image_transform, "image"), bounds: painterPath(row.image_bounds),
		}));
		const notes = query(db, "SELECT id,text,background_color FROM items_notes").map((row) => ({
			id: number(row.id, "note ID"), html: String(row.text ?? ""),
			backgroundColor: row.background_color == null ? null : String(row.background_color),
		}));
		return { items, images, imageItems, notes,
			groupIds: query(db, "SELECT id FROM items_groups").map((row) => number(row.id, "group ID")),
			drawingCount: query(db, "SELECT id FROM items_drawings").length };
	} finally {
		db.close();
	}
}

export function transformPoint(matrix: Matrix, point: Point): Point {
	const [a, b, c, d, e, f, g, h, i] = matrix;
	const divisor = c * point.x + f * point.y + i;
	if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-12) throw new Error("Non-invertible PureRef transform");
	return { x: (a * point.x + d * point.y + g) / divisor,
		y: (b * point.x + e * point.y + h) / divisor };
}
