import { Notice, type WorkspaceLeaf } from "obsidian";
import { pickPureRefExportPath } from "./electron";
import { getExcalidrawApi, getExcalidrawData, getExcalidrawFileForLeaf, getExcalidrawView, type SceneElement } from "./excalidraw-view";
import { writePureRef1Images, type PureRefExportImage, type PureRefExportText } from "./pur1-writer";
import { writePureRef2Scene, type PureRef2Item } from "./pur2-writer";

interface ExportImageElement extends SceneElement {
	fileId?: string;
	crop?: { x: number; y: number; width: number; height: number } | null;
	text?: string;
}

function loadImage(owner: Window, source: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = owner.document.createElement("img");
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error("Could not decode a Board image"));
		image.src = source;
	});
}

async function flattenImage(owner: Window, element: ExportImageElement, source: string): Promise<PureRefExportImage> {
	const image = await loadImage(owner, source);
	const crop = element.crop ?? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight };
	const angle = element.angle ?? 0;
	const cos = Math.cos(angle), sin = Math.sin(angle);
	const boardWidth = Math.abs(element.width * cos) + Math.abs(element.height * sin);
	const boardHeight = Math.abs(element.width * sin) + Math.abs(element.height * cos);
	if (![crop.x, crop.y, crop.width, crop.height, boardWidth, boardHeight].every(Number.isFinite)
		|| crop.width <= 0 || crop.height <= 0 || boardWidth <= 0 || boardHeight <= 0) {
		throw new Error("A Board image has invalid crop or placement geometry");
	}
	const pixelsPerBoardUnit = Math.min(crop.width / element.width, crop.height / element.height,
		8192 / Math.max(boardWidth, boardHeight), Math.sqrt(16_000_000 / (boardWidth * boardHeight)));
	const canvas = owner.document.createElement("canvas");
	canvas.width = Math.max(1, Math.ceil(boardWidth * pixelsPerBoardUnit));
	canvas.height = Math.max(1, Math.ceil(boardHeight * pixelsPerBoardUnit));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas rendering is unavailable");
	ctx.translate(canvas.width / 2, canvas.height / 2);
	ctx.rotate(angle);
	ctx.scale(element.scale?.[0] === -1 ? -1 : 1, element.scale?.[1] === -1 ? -1 : 1);
	ctx.globalAlpha = Math.max(0, Math.min(1, (element.opacity ?? 100) / 100));
	ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height,
		-element.width * pixelsPerBoardUnit / 2, -element.height * pixelsPerBoardUnit / 2,
		element.width * pixelsPerBoardUnit, element.height * pixelsPerBoardUnit);
	const dataUrl = canvas.toDataURL("image/png");
	return {
		png: new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")),
		x: (element.x + (element.width - boardWidth) / 2) * 4,
		y: (element.y + (element.height - boardHeight) / 2) * 4,
		width: boardWidth * 4,
		height: boardHeight * 4,
	};
}

function imageData(source: string): { mime: string; bytes: Uint8Array } | null {
	const match = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(source);
	return match ? { mime: match[1].toLowerCase(), bytes: new Uint8Array(Buffer.from(source.slice(match[0].length), "base64")) } : null;
}

function thumbnail(owner: Window): Uint8Array {
	const canvas = owner.document.createElement("canvas");
	canvas.width = 1; canvas.height = 1;
	const jpeg = canvas.toDataURL("image/jpeg", 0.7);
	return new Uint8Array(Buffer.from(jpeg.slice(jpeg.indexOf(",") + 1), "base64"));
}

/** Export supported images and standalone text from the current Board. */
export async function exportBoardToPureRef(leaf: WorkspaceLeaf, version: "1.x" | "2.x"): Promise<void> {
	try {
		const board = getExcalidrawFileForLeaf(leaf);
		const api = getExcalidrawApi(leaf);
		const data = getExcalidrawData(leaf);
		if (!board || !api?.getSceneElements || !api.getFiles || !data) throw new Error("Open a loaded Excalidraw Board first");
		const elements = api.getSceneElements().filter((el): el is ExportImageElement =>
			!el.isDeleted && (el.type === "image" || el.type === "text" && !el.containerId)).slice();
		if (elements.length === 0) { new Notice("This Board has no images or text to export."); return; }
		const owner = getExcalidrawView(leaf)?.containerEl?.ownerDocument?.defaultView ?? window;
		const destination = await pickPureRefExportPath(owner, `${board.basename}.pur`);
		if (!destination) return;
		const files = api.getFiles();
		const images: PureRefExportImage[] = [];
		const notes: PureRefExportText[] = [];
		const items2: PureRef2Item[] = [];
		let skipped = 0;
		for (const [index, element] of elements.entries()) {
			if (element.type === "text") {
				if (!element.text?.trim()) { skipped++; continue; }
				notes.push({ text: element.text, x: element.x * 4, y: element.y * 4, order: index + 1 });
				items2.push({ kind: "text", text: element.text, x: element.x, y: element.y,
					opacity: (element.opacity ?? 100) / 100 });
				continue;
			}
			if (!element.fileId) { skipped++; continue; }
			const source = files[element.fileId]?.dataURL ?? data.getFile?.(element.fileId)?.getImage?.(false);
			if (!source || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) { skipped++; continue; }
			if (version === "1.x") { images.push({ ...await flattenImage(owner, element, source), order: index + 1 }); continue; }
			const parsed = imageData(source)!;
			if (parsed.mime !== "image/png" && parsed.mime !== "image/jpeg" && parsed.mime !== "image/gif") {
				const flattened = await flattenImage(owner, element, source);
				const view = new DataView(flattened.png.buffer, flattened.png.byteOffset);
				items2.push({ kind: "image", data: flattened.png, format: "png",
					sourceWidth: view.getUint32(16, false), sourceHeight: view.getUint32(20, false),
					crop: { x: 0, y: 0, width: view.getUint32(16, false), height: view.getUint32(20, false) },
					x: flattened.x / 4, y: flattened.y / 4, width: flattened.width / 4, height: flattened.height / 4,
					angle: 0, flipX: false, flipY: false, opacity: 1 });
				continue;
			}
			const node = await loadImage(owner, source);
			items2.push({ kind: "image", data: parsed.bytes,
				format: parsed.mime === "image/jpeg" ? "jpg" : parsed.mime === "image/gif" ? "gif" : "png",
				sourceWidth: node.naturalWidth, sourceHeight: node.naturalHeight,
				crop: element.crop ?? { x: 0, y: 0, width: node.naturalWidth, height: node.naturalHeight },
				x: element.x, y: element.y, width: element.width, height: element.height, angle: element.angle ?? 0,
				flipX: element.scale?.[0] === -1, flipY: element.scale?.[1] === -1,
				opacity: (element.opacity ?? 100) / 100 });
		}
		if (images.length + notes.length === 0 && items2.length === 0) {
			new Notice("This Board has no supported images or standalone text to export."); return;
		}
		if (getExcalidrawFileForLeaf(leaf)?.path !== board.path) throw new Error("The Board changed during export");
		const bytes = version === "1.x" ? writePureRef1Images(images, notes) : await writePureRef2Scene(items2, thumbnail(owner));
		const fs = (window as Window & { require: (id: string) => typeof import("fs") }).require("fs");
		await fs.promises.writeFile(destination, bytes);
		new Notice(`Exported ${version} PureRef file to ${destination}${skipped ? ` (${skipped} unsupported items skipped)` : ""}`);
	} catch (error) {
		console.error("[Excalidraw PureRef] PureRef export failed", error);
		new Notice(`PureRef export failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
	}
}
