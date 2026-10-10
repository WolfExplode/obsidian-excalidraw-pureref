import type { WorkspaceLeaf } from "obsidian";
import type ExcalidrawPureRefPlugin from "../main";
import { matchBoardMetadata, type BoardSearchCandidate } from "./board-search-match";
import { getExcalidrawView } from "./excalidraw-view";
import { attachPerLeafScanner, onEvent } from "./leaf-scanner";
import { elementAABB } from "./pack-elements";

/** Append host-owned results without editing React-owned children or scene data. */
export function attachBoardSearch(plugin: ExcalidrawPureRefPlugin): () => void {
	return attachPerLeafScanner(plugin, {
		setup(leaf) {
			const container = leaf.view.containerEl;
			let panel: HTMLElement | null = null;
			let results: HTMLElement | null = null;
			let rendered = "";
			const update = () => {
				const current = container.querySelector<HTMLElement>(".layer-ui__search");
				if (current !== panel) {
					panel?.classList.remove("epr-has-search-matches");
					results?.remove();
					panel = current;
					results = null;
					rendered = "";
				}
				const input = panel?.querySelector<HTMLInputElement>("input");
				if (!panel || !input) return;
				const view = getExcalidrawView(leaf);
				const api = view?.excalidrawAPI;
				const elements = api?.getSceneElements?.() ?? [];
				const files = api?.getFiles?.() ?? {};
				const candidates = input.value.trim() ? elements.map(element => {
					const embedded = element.fileId ? view?.excalidrawData?.getFile?.(element.fileId) : undefined;
					const metadata = embedded as typeof embedded & { hyperlink?: string; mimeType?: string };
					return {
						...element,
						path: embedded?.file?.path || embedded?.linkParts?.path,
						originalLink: embedded?.linkParts?.original,
						hyperlink: metadata?.hyperlink,
						mimeType: element.fileId ? files[element.fileId]?.mimeType || metadata?.mimeType : undefined,
					} as BoardSearchCandidate;
				}) : [];
				const matches = matchBoardMetadata(candidates, input.value);
				const signature = JSON.stringify(matches);
				if (results?.parentElement === panel && rendered === signature) return;
				rendered = signature;
				if (!results || results.parentElement !== panel) results = panel.createDiv({ cls: "epr-board-search-results" });
				results.replaceChildren();
				panel.classList.toggle("epr-has-search-matches", matches.length > 0);
				if (!matches.length) return;
				results.createDiv({ cls: "epr-board-search-heading", text: `Files, links & types · ${matches.length}` });
				const select = (ids: string[], center: boolean) => selectMatches(leaf, ids, center);
				const all = results.createEl("button", { text: "Select all matches", attr: { type: "button" } });
				all.addEventListener("click", () => select(matches.map(match => match.id), false));
				const list = results.createDiv({ cls: "epr-board-search-list" });
				for (const match of matches) {
					const button = list.createEl("button", { text: match.label, attr: {
						type: "button", title: `${match.type}: ${match.label}`,
					} });
					button.addEventListener("click", () => select([match.id], true));
				}
			};
			const observer = new MutationObserver(update);
			observer.observe(container, { childList: true, subtree: true });
			container.addEventListener("input", update);
			update();
			return { update, dispose: () => {
				observer.disconnect();
				container.removeEventListener("input", update);
				panel?.classList.remove("epr-has-search-matches");
				results?.remove();
			} };
		},
		scan(_leaf, state) { state.update(); },
		teardown(_leaf, state) { state.dispose(); },
		extras(scanner) {
			return [onEvent(plugin.app.vault, () => plugin.app.vault.on("rename", () => {
				for (const [leaf] of scanner.entries()) scanner.rescan(leaf);
			}))];
		},
	});
}

function selectMatches(leaf: WorkspaceLeaf, ids: readonly string[], center: boolean): void {
	const view = getExcalidrawView(leaf);
	const api = view?.excalidrawAPI;
	if (!api?.getSceneElements || !view?.updateScene) return;
	const wanted = new Set(ids);
	const elements = api.getSceneElements().filter(element => !element.isDeleted && wanted.has(element.id));
	if (!elements.length) return;
	const appState: Record<string, unknown> = {
		selectedElementIds: Object.fromEntries(elements.map(element => [element.id, true])),
		selectedGroupIds: {}, editingGroupId: null, activeEmbeddable: null,
	};
	if (center) {
		const state = api.getAppState();
		const bounds = elementAABB(elements[0]);
		appState.scrollX = state.width / (2 * state.zoom.value) - (bounds.minX + bounds.maxX) / 2;
		appState.scrollY = state.height / (2 * state.zoom.value) - (bounds.minY + bounds.maxY) / 2;
	}
	view.updateScene({ appState });
}
