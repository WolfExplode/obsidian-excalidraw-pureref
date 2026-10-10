import { FileSystemAdapter, Notice, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import { showFileInExplorer } from "./electron";
import { findExcalidrawLeafForNode, getExcalidrawView } from "./excalidraw-view";

function selectedImageFile(leaf: WorkspaceLeaf): TFile | null {
	const view = getExcalidrawView(leaf);
	const api = view?.excalidrawAPI;
	if (!api?.getSceneElements) return null;
	try {
		const ids = api.getAppState().selectedElementIds ?? {};
		const selected = api.getSceneElements().filter(el => !el.isDeleted && ids[el.id]);
		if (selected.length !== 1 || selected[0].type !== "image" || !selected[0].fileId) return null;
		return view?.excalidrawData?.getFile?.(selected[0].fileId)?.file ?? null;
	} catch {
		return null;
	}
}

/** Extend the native menu once it mounts; React retains ownership of its popover. */
export function attachShowInExplorer(win: Window, app: App): () => void {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return () => {};
	const doc = win.document;
	let pending: { leaf: WorkspaceLeaf; previousMenu: Element | null } | null = null;
	const inject = () => {
		if (!pending) return;
		const menu = doc.querySelector<HTMLElement>(".context-menu");
		if (!menu || menu === pending.previousMenu) return;
		const { leaf } = pending;
		pending = null;
		observer.disconnect();
		if (menu.querySelector(".epr-show-in-explorer-menu")) return;
		const file = selectedImageFile(leaf);
		if (!file) return;
		const item = menu.createEl("li", { cls: "epr-show-in-explorer-menu" });
		const button = item.createEl("button", { cls: "context-menu-item", attr: { type: "button" } });
		button.createDiv({ cls: "context-menu-item__label", text: "Show in Explorer" });
		menu.prepend(item);
		button.addEventListener("click", event => {
			event.stopPropagation();
			// Hide rather than remove the React-owned popover, like Find Duplicates.
			menu.parentElement?.setCssStyles({ display: "none" });
			const current = app.vault.getAbstractFileByPath(file.path);
			if (current !== file) {
				new Notice("The image file is no longer in the vault.");
				return;
			}
			if (!showFileInExplorer(adapter.getFullPath(file.path))) {
				new Notice("Could not show the image file in Explorer.");
			}
		});
	};
	// The menu's DOM insertion is the readiness condition; no settle delay is needed.
	const observer = new MutationObserver(inject);
	const onContextMenu = (event: MouseEvent) => {
		observer.disconnect();
		const leaf = findExcalidrawLeafForNode(app, event.target as Node | null);
		pending = leaf ? { leaf, previousMenu: doc.querySelector(".context-menu") } : null;
		if (pending) observer.observe(doc.body, { childList: true, subtree: true });
	};
	doc.addEventListener("contextmenu", onContextMenu, true);
	return () => {
		pending = null;
		observer.disconnect();
		doc.removeEventListener("contextmenu", onContextMenu, true);
		doc.querySelectorAll(".epr-show-in-explorer-menu").forEach(item => item.remove());
	};
}
