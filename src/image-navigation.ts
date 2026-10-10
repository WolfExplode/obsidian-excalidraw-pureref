import { Notice } from "obsidian";
import type ExcalidrawPureRefPlugin from "../main";
import { getExcalidrawApi, type ExcalidrawApi, type ImageSceneElement } from "./excalidraw-view";
import { attachPerLeafScanner, leafDocument } from "./leaf-scanner";
import { isLodImageVisible, hasImageNavigationSupport } from "./image-lod-policy";
import { WorkerImageCache } from "./image-worker-cache";
import { ImageDecodeWorker } from "./image-decode-worker";

interface DisplayRequest {
	fileId: string; pixelWidth: number; pixelHeight: number; naturalWidth: number; naturalHeight: number;
}
interface LodApi extends ExcalidrawApi {
	setImageRenderSourceProvider?(provider: ((request: DisplayRequest) => ImageBitmap | null | undefined) | null): void;
	refreshImageRenderSources?(ids: ReadonlySet<string>): void;
}
const BUDGET = 96 * 1024 * 1024;

/** Worker JPEG preparation with Board previews; originals remain authoritative. */
export function attachImageNavigation(plugin: ExcalidrawPureRefPlugin): () => void {
	const enabled = () => plugin.imageNavigation.getEnabled();
	return attachPerLeafScanner(plugin, {
		setup(leaf) {
			const api = getExcalidrawApi(leaf) as LodApi | null;
			const win = leafDocument(leaf)?.defaultView;
			if (!api || !win) return null;
			const supported = hasImageNavigationSupport(api);
			if (!supported) plugin.recordDiagnostic("image-navigation-unavailable", { reason: "compatible-renderer-required" });
			let disposed = false;
			let attached = false;
			let worker: ImageDecodeWorker | null = null;
			let boardPath = (leaf.view as { file?: { path: string } }).file?.path;
			const cache = new WorkerImageCache<ImageBitmap>(BUDGET, req => {
				worker ??= new ImageDecodeWorker(win);
				return worker.decode(req);
			}, (ids, retired) => {
				// Source replacement can be discovered during rendering. Release the
				// renderer's references at the microtask boundary before closing pixels.
				win.queueMicrotask(() => {
					if (!disposed && attached) api.refreshImageRenderSources?.(ids);
					for (const bitmap of retired) bitmap.close();
				});
			}, error => plugin.recordDiagnostic("image-navigation-error", { message: String(error) }));
			const provider = (request: DisplayRequest) => {
				if (!enabled() || disposed) return undefined;
				const source = api.getFiles?.()[request.fileId]?.dataURL;
				if (!source) return undefined;
				return cache.get(request.fileId, source, request.naturalWidth, request.naturalHeight,
					request.pixelWidth, request.pixelHeight);
			};
			const scan = () => {
				if (disposed) return;
				const path = (leaf.view as { file?: { path: string } }).file?.path;
				if (path !== boardPath) { boardPath = path; cache.clear(); }
				if (!enabled() || !supported) {
					if (attached) { attached = false; api.setImageRenderSourceProvider?.(null); cache.clear(); worker?.dispose(); worker = null; }
					return;
				}
				const view = api.getAppState();
				const visible = new Set<string>();
				const sources = new Map<string, string>();
				const files = api.getFiles?.();
				for (const image of (api.getSceneElements?.() ?? []) as readonly ImageSceneElement[]) {
					if (image.type !== "image" || image.isDeleted || !image.fileId) continue;
					const source = files?.[image.fileId]?.dataURL;
					if (source) sources.set(image.fileId, source);
					if (isLodImageVisible(image, view)) visible.add(image.fileId);
				}
				cache.setVisible(visible);
				cache.setBoard(sources);
				if (!attached) { attached = true; api.setImageRenderSourceProvider?.(provider); }
			};
			const state = { scan, stop: () => {
				disposed = true;
				if (attached) api.setImageRenderSourceProvider?.(null);
				attached = false; cache.dispose(); worker?.dispose(); worker = null;
			}, stats: () => ({ supported, attached, worker: !!worker, ...cache.stats() }) };
			scan(); return state;
		},
		scan: (_leaf, state) => state.scan(),
		teardown: (_leaf, state) => state.stop(),
		extras(scanner) {
			plugin.imageNavigationDiagnostics = () => {
				const views = scanner.entries().map(([, state]) => state.stats());
				return { enabled: enabled(), status: !enabled() ? "disabled" :
					views.some(view => view.attached) ? "active" : views.length ? "unavailable" : "waiting-for-editor", views };
			};
			const changed = () => {
				for (const [leaf] of scanner.entries()) scanner.rescan(leaf);
				plugin.recordDiagnostic("image-navigation-preference", { enabled: enabled() });
			};
			plugin.addCommand({ id: "toggle-image-navigation", name: "Toggle smooth image navigation",
				callback: async () => {
					const entries = scanner.entries();
					if (!enabled() && !entries.some(([, state]) => state.stats().supported)) {
						new Notice("Smooth image navigation requires the compatible Excalidraw renderer build."); return;
					}
					try {
						await plugin.imageNavigation.setEnabled(!enabled());
						new Notice(`Smooth image navigation ${enabled() ? "enabled" : "disabled"}`);
					} catch (error) { new Notice(`Could not save image navigation preference: ${String(error)}`); }
				},
			});
			return [plugin.imageNavigation.onChange(changed), () => {
				plugin.imageNavigationDiagnostics = () => ({ enabled: false, status: "inactive" });
			}];
		},
	});
}
