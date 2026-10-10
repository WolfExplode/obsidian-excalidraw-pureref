import type ExcalidrawPureRefPlugin from "../main";
import { isExcalidrawLeaf } from "./excalidraw-view";
import { attachPerLeafScanner, leafDocument, onEvent, type LeafScannerApi, type ScannerElement } from "./leaf-scanner";

interface SelectionApi extends LeafScannerApi {
	getAppState(): { selectedElementIds?: Record<string, boolean> };
	getSceneElements(): readonly (ScannerElement & { customData?: { eprTransformProxy?: boolean } })[];
}

/** Show the active Board's selection beside Obsidian's other status counts. */
export function attachSelectionStatus(plugin: ExcalidrawPureRefPlugin): () => void {
	const item = plugin.addStatusBarItem();
	item.addClass("epr-selection-status");
	item.title = "Selected Board elements; media includes images and embeds";
	item.hidden = true;

	const render = (api: SelectionApi) => {
		const selected = api.getAppState().selectedElementIds ?? {};
		let elements = 0;
		let media = 0;
		for (const element of api.getSceneElements()) {
			if (!element.id || !selected[element.id] || element.isDeleted || element.customData?.eprTransformProxy) continue;
			elements++;
			if (element.type === "image" || element.type === "embeddable" || element.type === "iframe") media++;
		}
		const text = `${elements} ${elements === 1 ? "element" : "elements"} selected · ${media} media`;
		if (item.textContent !== text) item.textContent = text;
		item.hidden = false;
	};

	const activeBoard = () => {
		const leaf = plugin.app.workspace.getMostRecentLeaf();
		// The main status bar belongs to its own document. Popouts hide their chrome.
		return leaf && isExcalidrawLeaf(leaf) && leafDocument(leaf) === item.ownerDocument ? leaf : null;
	};

	const detach = attachPerLeafScanner<SelectionApi>(plugin, {
		setup(leaf, api) {
			if (typeof (api as Partial<SelectionApi>).getAppState !== "function") return null;
			const selectionApi = api as SelectionApi;
			if (leaf === activeBoard()) render(selectionApi);
			return selectionApi;
		},
		scan(leaf, api) {
			if (leaf === activeBoard()) render(api);
		},
		teardown(leaf) {
			if (leaf === activeBoard()) item.hidden = true;
		},
		extras(scanner) {
			const refresh = () => {
				const leaf = activeBoard();
				const entry = scanner.entries().find(([candidate]) => candidate === leaf);
				if (entry) render(entry[1]);
				else item.hidden = true;
			};
			const workspace = plugin.app.workspace;
			return [
				onEvent(workspace, () => workspace.on("active-leaf-change", refresh)),
				onEvent(workspace, () => workspace.on("layout-change", refresh)),
			];
		},
	});

	return () => {
		detach();
		item.remove();
	};
}
