import type { TFile, WorkspaceLeaf } from "obsidian";
import type ExcalidrawPureRefPlugin from "../main";
import { readSceneElements } from "./excalidraw-view";
import { randomVersionNonce } from "./excalidraw-element-mutation";

const ANIMATED_EXTENSIONS = new Set(["gif", "webp", "apng"]);

interface ImportedImage {
	id: string;
	type: string;
	fileId?: string | null;
	isDeleted?: boolean;
	version?: number;
	versionNonce?: number;
	updated?: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ExcalidrawAutomateLike {
	addEmbeddable(x: number, y: number, width: number, height: number, url?: string, file?: TFile): string | null;
	addElementsToView(repositionToCursor?: boolean, save?: boolean, newElementsOnTop?: boolean): Promise<boolean>;
	clear(): void;
	copyViewElementsToEAforEditing(elements: readonly ImportedImage[]): void;
	getElement(id: string): ImportedImage | undefined;
	destroy(): void;
}

interface ExcalidrawAutomateFactory {
	getAPI(view?: unknown): ExcalidrawAutomateLike | null;
}

function getExcalidrawAutomate(plugin: ExcalidrawPureRefPlugin, view: unknown): ExcalidrawAutomateLike | null {
	const fromWindow = (window as unknown as { ExcalidrawAutomate?: ExcalidrawAutomateFactory }).ExcalidrawAutomate;
	if (fromWindow?.getAPI) return fromWindow.getAPI(view);
	const host = (plugin.app as unknown as { plugins?: { plugins?: Record<string, { ea?: ExcalidrawAutomateFactory }> } })
		.plugins?.plugins?.["obsidian-excalidraw-plugin"];
	return host?.ea?.getAPI?.(view) ?? null;
}

/**
 * Upstream offers its image/embeddable choice only for a single external
 * animated file. A multi-file import has already inserted each file as an
 * image by the time the import tracker calls this, so replace only those
 * matched images. The caller supplies the resolved file from Excalidraw's own
 * registry; single-file modal choices and pre-existing Board images never enter
 * this path.
 */
export async function convertMultiDropAnimatedImage(
	plugin: ExcalidrawPureRefPlugin,
	leaf: WorkspaceLeaf,
	imageId: string,
	fileId: string,
	file: TFile,
): Promise<string | null> {
	if (!ANIMATED_EXTENSIONS.has(file.extension.toLowerCase())) return null;
	const image = (readSceneElements(leaf) ?? []).find((raw) => (raw as ImportedImage).id === imageId) as ImportedImage | undefined;
	if (!image || image.type !== "image" || image.fileId !== fileId) return null;
	const ea = getExcalidrawAutomate(plugin, leaf.view);
	if (!ea) return null;
	let embeddableId: string | null = null;
	const retire = async (element: ImportedImage): Promise<boolean> => {
		// A hard removal from the live array lets a pending import snapshot
		// resurrect the image. The host's merge needs a saved tombstone.
		ea.clear();
		ea.copyViewElementsToEAforEditing([element]);
		const copy = ea.getElement(element.id);
		if (!copy) return false;
		copy.isDeleted = true;
		copy.version = (element.version ?? 1) + 1;
		copy.versionNonce = randomVersionNonce();
		copy.updated = Date.now();
		if (!await ea.addElementsToView(false, true, true)) return false;
		const api = (leaf.view as unknown as {
			excalidrawAPI?: { getSceneElementsIncludingDeleted?: () => readonly ImportedImage[] };
		}).excalidrawAPI;
		return api?.getSceneElementsIncludingDeleted?.().some((raw) => raw.id === element.id && raw.isDeleted) === true;
	};
	const removeUncommittedEmbed = async () => {
		if (!embeddableId) return;
		const embed = (readSceneElements(leaf) ?? []).find((raw) => (raw as { id?: string }).id === embeddableId) as ImportedImage | undefined;
		if (embed) await retire(embed);
	};
	try {
		embeddableId = ea.addEmbeddable(image.x, image.y, image.width, image.height, undefined, file);
		if (!embeddableId || !await ea.addElementsToView(false, true, true)) return null;
		const current = (readSceneElements(leaf) ?? []).find((raw) => (raw as ImportedImage).id === imageId) as ImportedImage | undefined;
		if (!current || current.type !== "image" || current.fileId !== fileId) {
			await removeUncommittedEmbed();
			return null;
		}
		if (!await retire(current) || (readSceneElements(leaf) ?? []).some((raw) => (raw as ImportedImage).id === imageId)) {
			await removeUncommittedEmbed();
			return null;
		}
		return embeddableId;
	} catch (error) {
		await removeUncommittedEmbed();
		console.error("[Excalidraw PureRef] failed to convert a multi-drop animated image.", error);
		return null;
	} finally {
		ea.destroy();
	}
}
