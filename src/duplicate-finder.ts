import { Notice, type App, type WorkspaceLeaf } from "obsidian";
import { VIEWPORT_CROP_KEY } from "./crop-orchestrator";
import { isEditableTarget } from "./editable-target";
import { findExcalidrawLeafForNode, getExcalidrawApi, getExcalidrawView, type SceneElement } from "./excalidraw-view";
import { eventMatchesAnyBinding } from "./hotkey-match";
import type { HotkeyStore } from "./hotkey-store";
import { imageDuplicateSignature, selectedImagesWithDuplicates } from "./duplicate-images";

/** The scene-element fields any type's duplicate signature might read. */
interface DuplicateCandidateElement extends SceneElement {
	fileId?: string;
	link?: string | null;
	text?: string;
	fontFamily?: number;
	fontSize?: number;
	textAlign?: string;
	strokeColor?: string;
	backgroundColor?: string;
	fillStyle?: string;
	strokeWidth?: number;
	strokeStyle?: string;
	roughness?: number;
	points?: readonly (readonly [number, number])[];
	crop?: { width: number; height: number } | null;
	customData?: Record<string, unknown>;
}

/** Rounds away float noise (subpixel drift from resize/rotate) before it enters a signature string. */
function round(value: number | undefined): string {
	return value === undefined ? "" : (Math.round(value * 100) / 100).toString();
}

/**
 * An embeddable's `link`, normalized so the same target compares equal
 * regardless of how it's written: `[[note.mp4]]` and `note.mp4` are the same
 * vault file, and a `|alias` suffix doesn't change what's embedded. Unlike
 * board-render.ts's `localLinkpath`, this deliberately does NOT null out
 * `http(s)://` links -- two embeds of the same web video/URL are duplicates
 * too, and identity here only needs string equality, not vault resolution.
 */
function normalizedLink(link: string | null | undefined): string | null {
	if (!link) return null;
	let s = link.trim();
	const wiki = s.match(/^\[\[([^\]]+)\]\]$/);
	if (wiki) s = wiki[1];
	s = s.split("|")[0].trim();
	return s || null;
}

/**
 * Whether a cropped image counts as a duplicate of the same source file's
 * other crops (including the uncropped original) -- both Excalidraw's native
 * crop and this plugin's own hold-C custom crop (see
 * imageDuplicateSignature). Toggle to `false` to go back to treating each
 * distinct crop as its own thing -- e.g. if a board deliberately keeps
 * several different crops of one photo as separate references and those
 * shouldn't be flagged against each other.
 */
const TREAT_CROPS_AS_DUPLICATES = true;

/**
 * A content signature for one element, deliberately excluding position (x/y),
 * rotation, and identity fields (id, seed, version, updated, groupIds, frameId) --
 * two elements are "duplicates" if they'd look and behave the same wherever
 * they sat on the board. Returns null when the element has nothing to key on
 * (e.g. an unresolved embeddable with no link, or empty text).
 *
 * Images key on `fileId`: Excalidraw derives fileId as a content hash of the
 * file's bytes (`generateIdFromFile` upstream), so two image elements sharing
 * a fileId are backed by pixel-identical source data regardless of when or how
 * each was imported into the board -- this is exactly "does this image already
 * exist here", independent of size/position. Whether a different crop of that
 * same fileId also counts is gated by TREAT_CROPS_AS_DUPLICATES: when on, a
 * PureRef custom crop is traced back to its sourceFileId so it keys on
 * the file it was cropped FROM, not the disposable generated image it cropped
 * TO; when off, crop dimensions (native crop) or the element's own fileId
 * (custom crop) are folded into the signature so every distinct crop is kept
 * separate from the source and from each other.
 *
 * Embeddables (video, PDF, web embeds, …) carry no `fileId` -- that field is
 * image-only -- so they key on their normalized `link` instead: what vault
 * file or URL they point at. Without this, every embeddable of the same
 * on-canvas size and style falls through to the generic signature below and
 * reads as a duplicate of every other one, which is the bug this fixes (all
 * .mp4s / all PDFs / etc. looked identical regardless of which file they embed).
 *
 * Every other type falls back to a type + geometry + style signature so the
 * same search works for shapes, text, and freedraw strokes without any
 * per-type wiring at the call site.
 */
function elementSignature(el: DuplicateCandidateElement): string | null {
	if (el.type === "image") return imageDuplicateSignature(el, VIEWPORT_CROP_KEY, TREAT_CROPS_AS_DUPLICATES);
	if (el.type === "embeddable") {
		const link = normalizedLink(el.link);
		return link ? `embeddable:${link}` : null;
	}
	if (el.type === "text") {
		if (!el.text) return null;
		return `text:${el.fontFamily}:${round(el.fontSize)}:${el.textAlign}:${el.text}`;
	}
	const points = el.points ? JSON.stringify(el.points.map(([x, y]) => [round(x), round(y)])) : "";
	return [
		el.type,
		round(el.width),
		round(el.height),
		el.strokeColor,
		el.backgroundColor,
		el.fillStyle,
		round(el.strokeWidth),
		el.strokeStyle,
		round(el.roughness),
		points,
	].join(":");
}

/** Whether exactly one live element is selected -- Find Duplicates needs a single source element. */
function hasSingleElementSelected(leaf: WorkspaceLeaf | null): boolean {
	const api = getExcalidrawApi(leaf);
	if (!api?.getSceneElements) return false;
	try {
		const selected = api.getAppState().selectedElementIds ?? {};
		let count = 0;
		for (const element of api.getSceneElements()) {
			if (!element.isDeleted && selected[element.id] && ++count > 1) return false;
		}
		return count === 1;
	} catch {
		return false;
	}
}

export interface DuplicateSearchResult {
	sourceId: string;
	sourceType: string;
	matchIds: string[];
}

/**
 * Finds every other live element on the board whose content signature matches
 * the single currently-selected element. Returns null when the leaf/API is
 * unavailable or the selection isn't exactly one element.
 */
export function findDuplicatesOfSelection(leaf: WorkspaceLeaf | null): DuplicateSearchResult | null {
	const api = getExcalidrawApi(leaf);
	if (!api?.getSceneElements) return null;
	let live: readonly DuplicateCandidateElement[];
	let selectedIds: Record<string, boolean>;
	try {
		live = (api.getSceneElements() as readonly DuplicateCandidateElement[]).filter((el) => !el.isDeleted);
		selectedIds = api.getAppState().selectedElementIds ?? {};
	} catch {
		return null;
	}
	const selected = live.filter((el) => selectedIds[el.id]);
	if (selected.length !== 1) return null;
	const [source] = selected;
	const signature = elementSignature(source);
	if (!signature) return { sourceId: source.id, sourceType: source.type, matchIds: [] };
	const matchIds = live.filter((el) => el.id !== source.id && elementSignature(el) === signature).map((el) => el.id);
	return { sourceId: source.id, sourceType: source.type, matchIds };
}

/** Replaces the current selection with exactly these element ids. */
function selectSceneElementIds(leaf: WorkspaceLeaf | null, ids: readonly string[]): boolean {
	const view = getExcalidrawView(leaf);
	if (!view?.excalidrawAPI || !view.updateScene) return false;
	try {
		view.updateScene({ appState: {
			selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])),
			selectedGroupIds: {}, editingGroupId: null,
		} });
		return true;
	} catch {
		return false;
	}
}

/**
 * Runs the duplicate search for the current selection and surfaces the result:
 * selects the source plus every match (so they're all highlighted together on
 * canvas -- press Shift+1 to zoom-to-fit if any sit off-screen) and shows a
 * Notice with the count.
 */
function runDuplicateSearch(leaf: WorkspaceLeaf | null): void {
	const result = findDuplicatesOfSelection(leaf);
	if (!result) return;
	if (result.matchIds.length === 0) {
		new Notice(`No duplicates of this ${result.sourceType} found on this board.`);
		return;
	}
	selectSceneElementIds(leaf, [result.sourceId, ...result.matchIds]);
	const count = result.matchIds.length;
	new Notice(`Found ${count} duplicate${count === 1 ? "" : "s"} of this ${result.sourceType}. Selected on canvas.`);
}

function hasMultipleImagesSelected(leaf: WorkspaceLeaf): boolean {
	const api = getExcalidrawApi(leaf);
	if (!api?.getSceneElements) return false;
	const ids = api.getAppState().selectedElementIds ?? {};
	return api.getSceneElements().filter(element => !element.isDeleted && element.type === "image" && ids[element.id]).length >= 2;
}

function selectImagesWithDuplicates(leaf: WorkspaceLeaf): void {
	const api = getExcalidrawApi(leaf);
	if (!api?.getSceneElements) return;
	const ids = selectedImagesWithDuplicates(
		api.getSceneElements(), api.getAppState().selectedElementIds ?? {}, VIEWPORT_CROP_KEY, TREAT_CROPS_AS_DUPLICATES,
	);
	if (selectSceneElementIds(leaf, ids) && !ids.length) new Notice("No duplicate images in the selection. Selection cleared.");
}

/**
 * Adds duplicate actions to Excalidraw's native canvas context menu:
 * "Select images with duplicates" filters a multi-image selection;
 * "Find Duplicates" searches the Board from one selected element,
 * shown only when exactly one element is selected, and rebinds Ctrl/Cmd+F to
 * the same search while a single element is selected. Mirrors
 * image-normalize.ts's menu-injection approach (append a `<li>` matching
 * Excalidraw's own `context-menu-item` markup, since removing/replacing
 * existing nodes there can corrupt Excalidraw's own render tree -- see
 * context-menu-trim.ts).
 *
 * With nothing selected (or more than one element), Ctrl/Cmd+F is left alone
 * so Excalidraw's native "Find text on canvas" still opens as usual.
 */
export function attachDuplicateFinder(win: Window, app: App, hotkeys: HotkeyStore): () => void {
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.repeat || !eventMatchesAnyBinding(event, hotkeys.get("duplicate-finder"))) return;
		if (isEditableTarget(event.target)) return;
		const leaf = findExcalidrawLeafForNode(app, event.target as Node | null);
		if (!leaf || !hasSingleElementSelected(leaf)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		runDuplicateSearch(leaf);
	};
	let pending: { leaf: WorkspaceLeaf; previousMenu: Element | null } | null = null;
	const inject = () => {
		if (!pending) return;
		const { leaf, previousMenu } = pending;
		const menu = leaf.view.containerEl.ownerDocument.querySelector(".context-menu");
		if (!menu || menu === previousMenu) return;
		pending = null;
		observer.disconnect();
		if (menu.querySelector(".epr-find-duplicates-menu")) return;
		const multipleImages = hasMultipleImagesSelected(leaf);
		if (!multipleImages && !hasSingleElementSelected(leaf)) return;
		const item = menu.createEl("li", { cls: "epr-find-duplicates-menu" });
		const button = item.createEl("button", { cls: "context-menu-item", attr: { type: "button" } });
		button.createDiv({ cls: "context-menu-item__label", text: multipleImages ? "Select images with duplicates" : "Find Duplicates" });
		button.addEventListener("click", (click) => {
			click.stopPropagation();
			// Hide the React-owned popover before selection changes trigger a render.
			menu.parentElement?.setCssStyles({ display: "none" });
			if (multipleImages) selectImagesWithDuplicates(leaf);
			else runDuplicateSearch(leaf);
		});
	};
	const observer = new MutationObserver(inject);
	const onContextMenu = (event: MouseEvent) => {
		observer.disconnect();
		const leaf = findExcalidrawLeafForNode(app, event.target as Node | null);
		const doc = leaf?.view.containerEl.ownerDocument;
		pending = leaf && doc ? { leaf, previousMenu: doc.querySelector(".context-menu") } : null;
		// The native menu's insertion is observable; no timing delay is needed.
		if (pending && doc) observer.observe(doc.body, { childList: true, subtree: true });
	};
	win.addEventListener("contextmenu", onContextMenu, true);
	win.addEventListener("keydown", onKeyDown, true);
	return () => {
		pending = null;
		observer.disconnect();
		win.removeEventListener("contextmenu", onContextMenu, true);
		win.removeEventListener("keydown", onKeyDown, true);
		win.document.querySelectorAll(".epr-find-duplicates-menu").forEach(item => item.remove());
	};
}
