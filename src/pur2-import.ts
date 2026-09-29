import { Modal, Notice, Setting, arrayBufferToBase64, base64ToArrayBuffer, type TFile, type WorkspaceLeaf } from "obsidian";
import type ExcalidrawPureRefPlugin from "../main";
import { pickPureRefFileForDomWindow, readExternalFile } from "./electron";
import { DEFAULT_IMAGE_SCALE, findExcalidrawLeafForNode, getExcalidrawApi, getExcalidrawFileForLeaf, getExcalidrawView } from "./excalidraw-view";
import { readPureRefScene, transformPoint, type Point, type PureRefImage, type PureRefItem, type PureRefScene } from "./pur2-reader";

interface AutomateElement {
	x: number;
	y: number;
	width: number;
	height: number;
	opacity: number;
	locked: boolean;
}

interface ExcalidrawAutomateImport {
	getAPI?(view: unknown): ExcalidrawAutomateImport;
	style: { fontSize: number; fontFamily: number };
	addImage(x: number, y: number, file: TFile, scale?: boolean, anchor?: boolean): Promise<string | null>;
	addText(x: number, y: number, text: string): string;
	getElement(id: string): AutomateElement;
	addElementsToView(repositionToCursor?: boolean, save?: boolean, newElementsOnTop?: boolean): Promise<boolean>;
}

interface RenderedPlacement {
	item: PureRefItem;
	imageId: number;
	x: number;
	y: number;
	width: number;
	height: number;
	data: Uint8Array | null;
	format: string;
}

function getAutomate(plugin: ExcalidrawPureRefPlugin, leaf: WorkspaceLeaf): ExcalidrawAutomateImport {
	const host = (plugin.app as unknown as { plugins?: { plugins?: Record<string, { ea?: ExcalidrawAutomateImport }> } })
		.plugins?.plugins?.["obsidian-excalidraw-plugin"]?.ea
		?? (window as Window & { ExcalidrawAutomate?: ExcalidrawAutomateImport }).ExcalidrawAutomate;
	if (!host) throw new Error("The Excalidraw community plugin must be enabled");
	if (typeof host.getAPI !== "function") throw new Error("The Excalidraw Automate API is unavailable");
	return host.getAPI(getExcalidrawView(leaf));
}

function chain(scene: PureRefScene, item: PureRefItem, point: Point): Point {
	const byId = new Map(scene.items.map((entry) => [entry.id, entry]));
	let current: PureRefItem | undefined = item;
	let result = point;
	const visited = new Set<number>();
	while (current) {
		if (visited.has(current.id)) throw new Error("Cyclic PureRef group hierarchy");
		visited.add(current.id);
		result = transformPoint(current.transform, result);
		current = byId.get(current.parent);
	}
	return result;
}

function bounds(points: Point[]): { x: number; y: number; width: number; height: number } {
	const x = Math.min(...points.map((p) => p.x));
	const y = Math.min(...points.map((p) => p.y));
	return { x, y, width: Math.max(...points.map((p) => p.x)) - x,
		height: Math.max(...points.map((p) => p.y)) - y };
}

function near(a: number, b: number): boolean { return Math.abs(a - b) < 0.02; }

function fullAxisAligned(image: PureRefImage, source: Point[], clip: Point[]): boolean {
	if (source.length !== 4 || clip.length < 4) return false;
	const rect = bounds(source);
	const clipRect = bounds(clip);
	const corners = [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }];
	return near(source[0].y, source[1].y) && near(source[0].x, source[3].x)
		&& near(source[2].x, source[1].x) && near(source[2].y, source[3].y)
		&& source[1].x > source[0].x && source[3].y > source[0].y
		&& near(rect.x, clipRect.x) && near(rect.y, clipRect.y)
		&& near(rect.width, clipRect.width) && near(rect.height, clipRect.height)
		&& clip.every((point) => corners.some((corner) => near(point.x, corner.x) && near(point.y, corner.y)))
		&& image.width > 0 && image.height > 0;
}

function imageMime(format: string): string {
	const normalized = format === "jpg" ? "jpeg" : format;
	if (!["png", "jpeg", "gif", "webp", "bmp"].includes(normalized)) throw new Error(`Unsupported PureRef image format: ${format}`);
	return `image/${normalized}`;
}

function imageExtension(format: string): string { return format === "jpeg" ? "jpg" : format; }

async function decodeImage(data: Uint8Array, format: string): Promise<HTMLImageElement> {
	const src = `data:${imageMime(format)};base64,${arrayBufferToBase64(data.slice().buffer)}`;
	const image = new Image();
	image.src = src;
	await image.decode();
	return image;
}

function canvasPng(canvas: HTMLCanvasElement): Uint8Array {
	const dataUrl = canvas.toDataURL("image/png");
	return new Uint8Array(base64ToArrayBuffer(dataUrl.slice(dataUrl.indexOf(",") + 1)));
}

async function renderPlacement(
	scene: PureRefScene,
	item: PureRefItem,
	imageItem: PureRefScene["imageItems"][number],
	image: PureRefImage,
): Promise<RenderedPlacement> {
	const mapSource = (point: Point) => chain(scene, item, transformPoint(imageItem.imageTransform, point));
	const source = [mapSource({ x: 0, y: 0 }), mapSource({ x: image.width, y: 0 }),
		mapSource({ x: image.width, y: image.height }), mapSource({ x: 0, y: image.height })];
	const clip = imageItem.bounds.map((point) => chain(scene, item, point));
	const rect = bounds(clip);
	if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
		throw new Error(`Image item ${item.id} has invalid bounds`);
	}
	if (fullAxisAligned(image, source, clip)) return { item, imageId: image.id, ...rect, data: null, format: image.format };
	// Excalidraw images have rectangular bounds. Flatten an arbitrary PureRef clip
	// and affine transform to a transparent PNG so the visible result survives.
	const p0 = source[0], p1 = source[1], p2 = source[2], p3 = source[3];
	if (!near(p2.x, p1.x + p3.x - p0.x) || !near(p2.y, p1.y + p3.y - p0.y)) {
		throw new Error(`Image item ${item.id} uses an unsupported perspective transform`);
	}
	const imageNode = await decodeImage(image.data, image.format);
	const pixelScale = Math.min(1, 8192 / Math.max(rect.width, rect.height), Math.sqrt(16_000_000 / (rect.width * rect.height)));
	const canvas = createEl("canvas");
	canvas.width = Math.max(1, Math.ceil(rect.width * pixelScale));
	canvas.height = Math.max(1, Math.ceil(rect.height * pixelScale));
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas rendering is unavailable");
	ctx.scale(pixelScale, pixelScale);
	ctx.translate(-rect.x, -rect.y);
	ctx.beginPath();
	clip.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
	ctx.closePath();
	ctx.clip();
	ctx.transform((p1.x - p0.x) / image.width, (p1.y - p0.y) / image.width,
		(p3.x - p0.x) / image.height, (p3.y - p0.y) / image.height, p0.x, p0.y);
	ctx.drawImage(imageNode, 0, 0, image.width, image.height);
	return { item, imageId: image.id, ...rect, data: canvasPng(canvas), format: "png" };
}

function noteText(html: string): string {
	const parsed = new DOMParser().parseFromString(html, "text/html");
	parsed.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
	parsed.querySelectorAll("p, div, li").forEach((node) => node.append("\n"));
	return (parsed.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function noteFontSize(html: string): number {
	// A note's actual text may override the body default (usually 22 px).
	// Legacy 1.x notes contain plain text and use that default.
	const parsed = new DOMParser().parseFromString(html, "text/html");
	const pixelSize = (value: string): number | null => {
		const size = Number.parseFloat(value);
		return Number.isFinite(size) && size > 0 && value.endsWith("px") ? size : null;
	};
	for (const element of Array.from(parsed.body.querySelectorAll<HTMLElement>("p, span, div, li"))) {
		if (!element.textContent?.trim()) continue;
		const size = pixelSize(element.style.fontSize);
		if (size !== null) return size;
	}
	return pixelSize(parsed.body.style.fontSize) ?? 22;
}

/** File name without directory or extension; accepts both Windows and POSIX separators. */
function fileStem(pathOrName: string): string {
	const base = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(0, dot) : base;
}

function safeName(name: string): string {
	const printable = Array.from(name, (char) => (char.charCodeAt(0) < 0x20 ? "_" : char)).join("");
	return printable.replace(/[<>:"/\\|?*[\]#^]/g, "_").trim().slice(0, 90) || "PureRef import";
}

function opacity(value: number): number {
	return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

function inheritedAppearance(scene: PureRefScene, item: PureRefItem): { opacity: number; locked: boolean } {
	const byId = new Map(scene.items.map((entry) => [entry.id, entry]));
	let opacityFraction = 1;
	let locked = false;
	let current: PureRefItem | undefined = item;
	const visited = new Set<number>();
	while (current) {
		if (visited.has(current.id)) throw new Error("Cyclic PureRef group hierarchy");
		visited.add(current.id);
		opacityFraction *= current.opacity <= 1 ? current.opacity : current.opacity / 100;
		locked ||= current.locked;
		current = byId.get(current.parent);
	}
	return { opacity: opacity(opacityFraction), locked };
}

async function importScene(plugin: ExcalidrawPureRefPlugin, leaf: WorkspaceLeaf, sourceName: string, source: Uint8Array): Promise<string> {
	const boardFile = getExcalidrawFileForLeaf(leaf);
	if (!boardFile || !getExcalidrawApi(leaf)) throw new Error("Open an Excalidraw Board before importing");
	const scene = await readPureRefScene(source);
	const itemById = new Map(scene.items.map((item) => [item.id, item]));
	const imageById = new Map(scene.images.map((image) => [image.id, image]));
	for (const image of scene.images) imageMime(image.format);
	const placements: RenderedPlacement[] = [];
	for (const placed of scene.imageItems) {
		const item = itemById.get(placed.id), image = imageById.get(placed.imageId);
		if (!item || !image) throw new Error(`PureRef image item ${placed.id} has a missing reference`);
		placements.push(await renderPlacement(scene, item, placed, image));
	}
	const stem = safeName(fileStem(sourceName));
	if (getExcalidrawFileForLeaf(leaf)?.path !== boardFile.path || !getExcalidrawApi(leaf)) {
		throw new Error("The target Board closed while the PureRef file was loading");
	}
	const automate = getAutomate(plugin, leaf);
	const originalFontSize = automate.style.fontSize;
	const originalFontFamily = automate.style.fontFamily;
	const originalFiles = new Map<number, TFile>();
	const created: TFile[] = [];
	let commitAttempted = false;
	try {
		const neededOriginals = new Set(placements.filter((placement) => !placement.data).map((placement) => placement.imageId));
		for (const image of scene.images.filter((image) => neededOriginals.has(image.id))) {
			const attachmentPath = await plugin.app.fileManager.getAvailablePathForAttachment(
				`${stem}-source-${image.id}.${imageExtension(image.format)}`, boardFile.path);
			const file = await plugin.app.vault.createBinary(attachmentPath,
				image.data.slice().buffer);
			originalFiles.set(image.id, file);
			created.push(file);
		}
		const flattenedFiles = new Map<number, TFile>();
		for (const placement of placements) {
			if (!placement.data) continue;
			const attachmentPath = await plugin.app.fileManager.getAvailablePathForAttachment(
				`${stem}-placement-${placement.item.id}.png`, boardFile.path);
			const file = await plugin.app.vault.createBinary(attachmentPath, placement.data.slice().buffer);
			flattenedFiles.set(placement.item.id, file);
			created.push(file);
		}
		const ordered = [
			...placements.map((placement) => ({ kind: "image" as const, item: placement.item, placement })),
			...scene.notes.map((note) => ({ kind: "note" as const, item: itemById.get(note.id), note })),
		].filter((entry) => entry.item).sort((a, b) => a.item!.z - b.item!.z || a.item!.id - b.item!.id);
		for (const entry of ordered) {
			const item = entry.item!;
			const appearance = inheritedAppearance(scene, item);
			if (entry.kind === "image") {
				const placement = entry.placement;
				const file = flattenedFiles.get(item.id) ?? originalFiles.get(placement.imageId);
				if (!file) throw new Error(`Missing imported image ${placement.imageId}`);
				const id = await automate.addImage(
					placement.x * DEFAULT_IMAGE_SCALE, placement.y * DEFAULT_IMAGE_SCALE, file, false, false);
				if (!id) throw new Error(`Excalidraw could not load image ${file.name}`);
				const element = automate.getElement(id);
				element.width = placement.width * DEFAULT_IMAGE_SCALE;
				element.height = placement.height * DEFAULT_IMAGE_SCALE;
				element.opacity = appearance.opacity;
				element.locked = appearance.locked;
			} else {
				const text = noteText(entry.note.html);
				if (!text) continue;
				const position = chain(scene, item, { x: 0, y: 0 });
				const unitDown = chain(scene, item, { x: 0, y: 1 });
				const scale = Math.hypot(unitDown.x - position.x, unitDown.y - position.y);
				const declaredSize = noteFontSize(entry.note.html);
				// Qt records a 9 pt note as 12 CSS px. The item transform scales
				// those pixels into PureRef scene coordinates, just as it does images.
				const fontSize = declaredSize * scale * DEFAULT_IMAGE_SCALE;
				if (!Number.isFinite(fontSize) || fontSize <= 0) throw new Error(`PureRef note ${item.id} has invalid text size`);
				// ExcalidrawAutomate's element style, not a DOM style. Font family 2
				// (Helvetica) is Excalidraw's closest Open Sans match.
				Object.assign(automate.style, { fontSize, fontFamily: 2 });
				const id = automate.addText(
					position.x * DEFAULT_IMAGE_SCALE, position.y * DEFAULT_IMAGE_SCALE, text);
				automate.style.fontSize = originalFontSize;
				automate.style.fontFamily = originalFontFamily;
				const element = automate.getElement(id);
				// PureRef's item transform is the note's visual center. Excalidraw
				// stores a text element at the top-left of its measured box.
				element.x -= element.width / 2;
				element.y -= element.height / 2;
				// Qt's rich-text document includes a half-em inset around its glyphs.
				// Match that inset after Excalidraw measures the equivalent text box.
				element.x -= fontSize / 2;
				element.y += fontSize / 2;
				element.opacity = appearance.opacity;
				element.locked = appearance.locked;
			}
		}
		automate.style.fontSize = originalFontSize;
		automate.style.fontFamily = originalFontFamily;
		if (getExcalidrawFileForLeaf(leaf)?.path !== boardFile.path || !getExcalidrawApi(leaf)) {
			throw new Error("The target Board closed while the import was being prepared");
		}
		commitAttempted = true;
		if (!await automate.addElementsToView(false, true, true)) throw new Error("Excalidraw did not accept the imported elements");
		return boardFile.path;
	} catch (error) {
		// Once Excalidraw starts its commit, a failed response does not prove the
		// elements were rejected. Keep their attachments so any accepted image
		// remains valid; before that point these files are exclusively ours.
		if (!commitAttempted) {
			for (const file of created.reverse()) await plugin.app.fileManager.trashFile(file).catch(() => undefined);
		}
		throw error;
	} finally {
		automate.style.fontSize = originalFontSize;
		automate.style.fontFamily = originalFontFamily;
	}
}

export async function importPureRefFile(plugin: ExcalidrawPureRefPlugin, leaf: WorkspaceLeaf, owner: Window): Promise<void> {
	try {
		const file = await pickPureRefFileForDomWindow(owner);
		if (!file) return;
		new Notice("Importing PureRef scene…");
		const board = await importScene(plugin, leaf, file, await readExternalFile(file));
		new Notice(`Imported PureRef scene into ${board}`);
	} catch (error) {
		console.error("[Excalidraw PureRef] import failed", error);
		new Notice(`PureRef import failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
	}
}

/** Shows the import-or-link choice for .pur files dropped onto an editable Board. */
export function promptPureRefDrop(
	plugin: ExcalidrawPureRefPlugin,
	event: DragEvent,
	files: readonly File[],
	link: () => void,
): boolean {
	const target = event.target as Node | null;
	const leaf = findExcalidrawLeafForNode(plugin.app, target);
	const container = leaf?.view.containerEl;
	const pointed = target?.ownerDocument?.elementFromPoint(event.clientX, event.clientY);
	if (!leaf || !container || !(target && container.contains(target)) && !(pointed && container.contains(pointed))) return false;
	if (!getExcalidrawFileForLeaf(leaf) || !getExcalidrawApi(leaf)) return false;

	const importDroppedFiles = async (): Promise<void> => {
		for (const file of files) {
			try {
				new Notice(`Importing ${file.name}…`);
				const board = await importScene(plugin, leaf, file.name, new Uint8Array(await file.arrayBuffer()));
				new Notice(`Imported ${file.name} into ${board}`);
			} catch (error) {
				console.error("[Excalidraw PureRef] dropped file import failed", error);
				new Notice(`PureRef import failed: ${error instanceof Error ? error.message : String(error)}`, 10000);
			}
		}
	};

	class PureRefDropModal extends Modal {
		onOpen(): void {
			this.setTitle(files.length === 1 ? `Drop ${files[0].name}` : `Drop ${files.length} PureRef files`);
			this.contentEl.createEl("p", { text: "Choose how to add the PureRef file to this Board." });
			new Setting(this.contentEl)
				.addButton((button) => button.setButtonText("Import all media").setCta().onClick(() => {
					this.close();
					void importDroppedFiles();
				}))
				.addButton((button) => button.setButtonText("Link file").onClick(() => {
					this.close();
					link();
				}));
		}
	}

	new PureRefDropModal(plugin.app).open();
	return true;
}
