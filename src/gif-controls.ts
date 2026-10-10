import { Notice, type TFile, type WorkspaceLeaf } from "obsidian";
import type ExcalidrawPureRefPlugin from "../main";
import { localLinkpath } from "./board-render";
import { getExcalidrawApi, getExcalidrawFileForLeaf, getExcalidrawView, type SceneElement } from "./excalidraw-view";
import { attachPerLeafScanner } from "./leaf-scanner";
import { GifPlayer, type GifDecoderConstructor } from "./gif-player";

interface Session {
	id: string;
	file: TFile;
	img: HTMLImageElement;
	canvas: HTMLCanvasElement;
	player: GifPlayer;
	visibility: string;
	position: string;
	parent: HTMLElement;
	ready: boolean;
}
interface State {
	root: HTMLElement;
	win: Window;
	bar: HTMLElement;
	play: HTMLButtonElement;
	slider: HTMLInputElement;
	counter: HTMLElement;
	speed: HTMLSelectElement;
	extract: HTMLButtonElement;
	sessions: Map<string, Session>;
	pending: Set<string>;
	failed: Set<string>;
	selected: string | null;
	disposed: boolean;
	raf: number;
	observer: MutationObserver;
}

interface Automate {
	getAPI(view: unknown): Automate;
	addImage(x: number, y: number, file: TFile, scale: boolean, anchor: boolean): Promise<string | null>;
	getElement(id: string): { width: number; height: number };
	addElementsToView(reposition: boolean, save: boolean, onTop: boolean): Promise<boolean>;
	destroy(): void;
}

/** New images use upstream Automate, which owns all image registries and the saved Board. */
async function extractFrame(plugin: ExcalidrawPureRefPlugin, leaf: WorkspaceLeaf, session: Session): Promise<void> {
	const view = leaf.view;
	const board = getExcalidrawFileForLeaf(leaf);
	const api = getExcalidrawApi(leaf);
	if (!board || !api) throw new Error("The Board is no longer open");
	const blob = await session.player.snapshot();
	const frame = session.player.frame + 1;
	const bytes = await blob.arrayBuffer();
	const host = (plugin.app as unknown as { plugins: { plugins: Record<string, { ea?: Automate }> } })
		.plugins.plugins["obsidian-excalidraw-plugin"]?.ea;
	if (!host?.getAPI) throw new Error("Excalidraw Automate is unavailable");
	const ea = host.getAPI(getExcalidrawView(leaf));
	let file: TFile | null = null;
	let attempted = false;
	try {
		const path = await plugin.app.fileManager.getAvailablePathForAttachment(
			`${session.file.basename.replace(/[\[\]#^|]/g, "_")}-frame-${frame}-${Date.now()}.png`, board.path);
		file = await plugin.app.vault.createBinary(path, bytes);
		if (leaf.view !== view || getExcalidrawApi(leaf) !== api || getExcalidrawFileForLeaf(leaf) !== board) {
			throw new Error("The target Board changed during extraction");
		}
		const source = api.getSceneElements?.().find(el => el.id === session.id && !el.isDeleted);
		if (!source) throw new Error("The GIF was removed during extraction");
		const id = await ea.addImage(source.x + source.width + 24, source.y, file, false, false);
		if (!id) throw new Error("Excalidraw could not load the extracted frame");
		const image = ea.getElement(id);
		image.width = source.width;
		image.height = source.width * session.canvas.height / session.canvas.width;
		if (leaf.view !== view || getExcalidrawApi(leaf) !== api || getExcalidrawFileForLeaf(leaf) !== board) {
			throw new Error("The target Board changed during extraction");
		}
		attempted = true;
		const accepted = await ea.addElementsToView(false, true, true);
		if (!accepted || !api.getSceneElements?.().some(el => el.id === id && !el.isDeleted)) {
			throw new Error("Could not confirm insertion; the extracted PNG was kept in the vault");
		}
	} catch (error) {
		// Once insertion starts, keep the file if the outcome cannot be observed safely.
		if (file && !attempted) await plugin.app.vault.delete(file);
		throw error;
	} finally { ea.destroy(); }
}

function release(session: Session): void {
	session.player.dispose();
	session.canvas.remove();
	session.img.style.visibility = session.visibility;
	session.parent.style.position = session.position;
}

function selectedSession(state: State): Session | undefined {
	return state.selected ? state.sessions.get(state.selected) : undefined;
}

function updateBar(state: State): void {
	const session = selectedSession(state);
	state.bar.hidden = !session?.ready;
	if (!session?.ready) return;
	const player = session.player;
	const playLabel = player.playing ? "Pause" : "Play";
	if (state.play.textContent !== playLabel) state.play.textContent = playLabel;
	state.play.setAttribute("aria-label", player.playing ? "Pause GIF" : "Play GIF");
	state.slider.max = String(player.frameCount - 1);
	state.slider.value = String(player.frame);
	const count = `${player.frame + 1} / ${player.frameCount}`;
	if (state.counter.textContent !== count) state.counter.textContent = count;
	state.speed.value = String(player.speed);
	const box = session.img.getBoundingClientRect();
	const root = state.root.getBoundingClientRect();
	const width = state.bar.offsetWidth;
	state.bar.style.left = `${Math.max(0, Math.min(root.width - width, box.left - root.left + (box.width - width) / 2))}px`;
	state.bar.style.top = `${Math.max(0, Math.min(root.height - state.bar.offsetHeight, box.bottom - root.top + 8))}px`;
}

function report(error: unknown): void {
	console.error("[EPR GIF]", error);
	new Notice(`GIF controls: ${error instanceof Error ? error.message : String(error)}`);
}

function gifFile(plugin: ExcalidrawPureRefPlugin, leaf: WorkspaceLeaf, element: SceneElement): TFile | null {
	if (element.type !== "embeddable" || element.isDeleted) return null;
	const path = localLinkpath((element as SceneElement & { link?: string }).link);
	const file = path ? plugin.app.metadataCache.getFirstLinkpathDest(path, getExcalidrawFileForLeaf(leaf)?.path ?? "") : null;
	return file?.extension.toLowerCase() === "gif" ? file : null;
}

function gifImage(state: State, id: string): HTMLImageElement | null {
	// CustomEmbeddable's stable id; never guess by DOM order or shared file URL.
	const embed = state.root.ownerDocument.getElementById(`embed-${id}`);
	return embed && state.root.contains(embed) ? embed.querySelector<HTMLImageElement>("img") : null;
}

async function attachSession(plugin: ExcalidrawPureRefPlugin, leaf: WorkspaceLeaf, state: State,
	id: string, file: TFile, img: HTMLImageElement): Promise<void> {
	state.pending.add(id);
	let session: Session | null = null;
	try {
		const Decoder = (state.win as Window & { ImageDecoder?: GifDecoderConstructor }).ImageDecoder;
		if (!Decoder) throw new Error("This Obsidian version does not support native GIF decoding");
		const bytes = await plugin.app.vault.readBinary(file);
		if (state.disposed || state.selected !== id || gifImage(state, id) !== img) return;
		const parent = img.parentElement;
		if (!parent) return;
		const canvas = state.root.ownerDocument.createElement("canvas");
		canvas.className = "epr-gif-frame";
		const player = new GifPlayer(new Decoder({ data: bytes, type: "image/gif" }), canvas,
			() => updateBar(state), () => state.win.performance.now());
		session = { id, file, img, canvas, player, parent, visibility: img.style.visibility,
			position: parent.style.position, ready: false };
		state.sessions.set(id, session);
		await player.init();
		if (state.disposed || state.sessions.get(id) !== session || gifImage(state, id) !== img) {
			if (state.sessions.get(id) === session) { state.sessions.delete(id); release(session); }
			return;
		}
		if (state.win.getComputedStyle(parent).position === "static") parent.style.position = "relative";
		parent.appendChild(canvas);
		img.style.visibility = "hidden";
		session.ready = true;
		updateBar(state);
	} catch (error) {
		if (session && state.sessions.get(id) === session) { state.sessions.delete(id); release(session); }
		if (!state.disposed) { state.failed.add(id); report(error); }
	} finally { state.pending.delete(id); }
}

export function attachGifControls(plugin: ExcalidrawPureRefPlugin): () => void {
	return attachPerLeafScanner<State>(plugin, {
		setup(leaf, _api, scanner) {
			const root = leaf.view.containerEl.querySelector<HTMLElement>(".excalidraw");
			const win = root?.ownerDocument.defaultView;
			if (!root || !win) return null;
			const bar = root.createDiv({ cls: "epr-gif-controls" });
			bar.hidden = true;
			bar.setAttribute("role", "toolbar");
			bar.setAttribute("aria-label", "GIF playback and frame extraction");
			// Controls own their gestures; Excalidraw must not pan or deselect beneath them.
			for (const name of ["pointerdown", "mousedown", "click", "dblclick", "keydown", "wheel"]) {
				bar.addEventListener(name, event => event.stopPropagation());
			}
			const button = (label: string) => bar.createEl("button", { text: label, attr: { type: "button", "aria-label": label } });
			const play = button("Pause");
			const prev = button("Previous frame"); prev.textContent = "‹";
			const next = button("Next frame"); next.textContent = "›";
			const slider = bar.createEl("input", { attr: { type: "range", min: "0", step: "1", "aria-label": "GIF frame" } });
			const counter = bar.createSpan();
			const speed = bar.createEl("select", { attr: { "aria-label": "GIF playback speed" } });
			for (const rate of [0.25, 0.5, 1, 1.5, 2, 4]) speed.createEl("option", { value: String(rate), text: `${rate}×` });
			const extract = button("Extract");
			const observer = new (win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver(records => {
				if (records.some(record => !bar.contains(record.target))) scanner.rescan(leaf);
			});
			const state: State = { root, win, bar, play, slider, counter, speed, extract,
				sessions: new Map(), pending: new Set(), failed: new Set(), selected: null, disposed: false, raf: 0, observer };
			play.onclick = () => selectedSession(state)?.player.toggle();
			prev.onclick = () => { void selectedSession(state)?.player.step(-1).catch(report); };
			next.onclick = () => { void selectedSession(state)?.player.step(1).catch(report); };
			slider.oninput = () => {
				const player = selectedSession(state)?.player;
				if (player) { player.playing = false; void player.seek(Number(slider.value)).catch(report); }
			};
			speed.onchange = () => selectedSession(state)?.player.setSpeed(Number(speed.value));
			extract.onclick = () => {
				const session = selectedSession(state);
				if (!session || extract.disabled) return;
				const controls = Array.from(bar.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("button, input, select"));
				for (const control of controls) control.disabled = true;
				void extractFrame(plugin, leaf, session).catch(report).finally(() => {
					for (const control of controls) control.disabled = false;
				});
			};
			observer.observe(root, { childList: true, subtree: true });
			const animate = (time: number) => {
				if (state.disposed) return;
				for (const session of state.sessions.values()) {
					if (!session.ready || !session.img.isConnected) continue;
					void session.player.tick(time).catch(error => { session.player.playing = false; report(error); });
				}
				updateBar(state);
				state.raf = win.requestAnimationFrame(animate);
			};
			state.raf = win.requestAnimationFrame(animate);
			queueMicrotask(() => scanner.rescan(leaf));
			return state;
		},
		scan(leaf, state) {
			const api = getExcalidrawApi(leaf);
			const elements = api?.getSceneElements?.() ?? [];
			const selected = api?.getAppState().selectedElementIds ?? {};
			const ids = Object.keys(selected).filter(id => selected[id]);
			state.selected = ids.length === 1 ? ids[0] : null;
			for (const [id, session] of state.sessions) {
				const element = elements.find(el => el.id === id);
				if (element && gifFile(plugin, leaf, element) === session.file && gifImage(state, id) === session.img) continue;
				state.sessions.delete(id); release(session);
			}
			const element = elements.find(el => el.id === state.selected);
			const file = element ? gifFile(plugin, leaf, element) : null;
			const img = element ? gifImage(state, element.id) : null;
			if (element && file && img && !state.sessions.has(element.id) && !state.pending.has(element.id) && !state.failed.has(element.id)) {
				void attachSession(plugin, leaf, state, element.id, file, img);
			}
			updateBar(state);
		},
		teardown(_leaf, state) {
			state.disposed = true;
			state.observer.disconnect();
			state.win.cancelAnimationFrame(state.raf);
			for (const session of state.sessions.values()) release(session);
			state.sessions.clear();
			state.bar.remove();
		},
	});
}
