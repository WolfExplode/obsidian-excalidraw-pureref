import type { App, WorkspaceLeaf } from "obsidian";
import { subtractBoxFromSelection, type BoxMode, type DeselectElement, type SceneBox } from "./box-deselect";
import { clientToSceneCoords, getExcalidrawApi, setSelection } from "./excalidraw-view";
import { chordMatches } from "./hotkey-match";
import type { HotkeyStore } from "./hotkey-store";
import { attachPointerDrag, findCanvasLeaf } from "./pointer-drag";

/** Below this client-pixel distance the gesture is a click, handed back to Excalidraw. */
const MIN_DRAG_PX = 4;

const RELAYED_POINTER_EVENT = "__eprDeselectDragRelayed";

interface DeselectGesture {
	leaf: WorkspaceLeaf;
	target: EventTarget;
	down: PointerEvent;
	elements: readonly DeselectElement[];
	selectedElementIds: Record<string, boolean>;
	selectedGroupIds: Record<string, boolean>;
	editingGroupId: string | null;
	mode: BoxMode;
	dragging: boolean;
}

function isRelayed(event: Event): boolean {
	return !!(event as unknown as Record<string, unknown>)[RELAYED_POINTER_EVENT];
}

/**
 * Hands a click (no drag) back to Excalidraw by replaying its pointerdown and
 * pointerup, so Ctrl-click keeps its normal meaning — including the host
 * plugin's Ctrl-click link opening, which runs from Excalidraw's pointerdown.
 */
function replayClick(gesture: DeselectGesture, up: PointerEvent): void {
	for (const source of [gesture.down, up]) {
		const replay = new PointerEvent(source.type, {
			bubbles: true,
			cancelable: true,
			composed: true,
			pointerId: source.pointerId,
			pointerType: source.pointerType,
			isPrimary: source.isPrimary,
			button: source.button,
			buttons: source.buttons,
			clientX: source.clientX,
			clientY: source.clientY,
			screenX: source.screenX,
			screenY: source.screenY,
			ctrlKey: source.ctrlKey,
			shiftKey: source.shiftKey,
			metaKey: source.metaKey,
			altKey: source.altKey,
		});
		Object.defineProperty(replay, RELAYED_POINTER_EVENT, { value: true });
		gesture.target.dispatchEvent(replay);
	}
}

/**
 * PureRef-style box deselect: hold the modifier (Ctrl by default) and drag a
 * rectangle; every selected element it catches leaves the selection, live as
 * the box moves. It honours Excalidraw's contain/overlap box-selection setting
 * and deselects groups as a unit. Escape restores the original selection.
 *
 * With nothing selected the gesture never starts, so Excalidraw's own Ctrl-drag
 * box select is unchanged there. A Ctrl-click without a drag is replayed to
 * Excalidraw untouched.
 */
export function attachDeselectDrag(win: Window, app: App, hotkeys: HotkeyStore): () => void {
	const doc = win.document;
	let overlay: HTMLDivElement | null = null;
	let current: DeselectGesture | null = null;

	const removeOverlay = () => {
		overlay?.remove();
		overlay = null;
	};

	const sceneBox = (gesture: DeselectGesture, event: PointerEvent): SceneBox | null => {
		const p1 = clientToSceneCoords(gesture.leaf, gesture.down.clientX, gesture.down.clientY);
		const p2 = clientToSceneCoords(gesture.leaf, event.clientX, event.clientY);
		if (!p1 || !p2) return null;
		return { minX: Math.min(p1.x, p2.x), minY: Math.min(p1.y, p2.y), maxX: Math.max(p1.x, p2.x), maxY: Math.max(p1.y, p2.y) };
	};

	/** Recomputes from the gesture-start selection, so shrinking the box re-selects. */
	const apply = (gesture: DeselectGesture, event: PointerEvent) => {
		const box = sceneBox(gesture, event);
		if (!box) return;
		const next = subtractBoxFromSelection({ ...gesture, box });
		setSelection(gesture.leaf, next.selectedElementIds, next.selectedGroupIds);
	};

	const updateOverlay = (gesture: DeselectGesture, event: PointerEvent) => {
		if (!overlay) {
			overlay = doc.body.createDiv();
			overlay.style.cssText =
				"position:fixed;z-index:99999;pointer-events:none;box-sizing:border-box;" +
				"border:1px dashed var(--text-error,#e03131);background:rgba(224,49,49,0.08);";
		}
		const { clientX: x0, clientY: y0 } = gesture.down;
		overlay.style.left = `${Math.min(x0, event.clientX)}px`;
		overlay.style.top = `${Math.min(y0, event.clientY)}px`;
		overlay.style.width = `${Math.abs(event.clientX - x0)}px`;
		overlay.style.height = `${Math.abs(event.clientY - y0)}px`;
	};

	const drag = attachPointerDrag<DeselectGesture>(win, {
		onStart(event) {
			if (event.button !== 0 || isRelayed(event)) return null;
			if (!chordMatches(event, hotkeys.get("deselect-drag-modifier"))) return null;
			const leaf = findCanvasLeaf(app, event.target);
			const api = getExcalidrawApi(leaf);
			if (!leaf || !event.target || !api?.getSceneElements) return null;
			try {
				const state = api.getAppState();
				const selectedElementIds = state.selectedElementIds ?? {};
				if (!Object.values(selectedElementIds).some(Boolean)) return null;
				current = {
					leaf,
					target: event.target,
					down: event,
					elements: api.getSceneElements(),
					selectedElementIds,
					selectedGroupIds: state.selectedGroupIds ?? {},
					editingGroupId: state.editingGroupId ?? null,
					mode: state.boxSelectionMode === "overlap" ? "overlap" : "contain",
					dragging: false,
				};
				return current;
			} catch {
				return null;
			}
		},
		onMove(event, gesture) {
			if (!gesture.dragging) {
				const dx = event.clientX - gesture.down.clientX;
				const dy = event.clientY - gesture.down.clientY;
				if (Math.hypot(dx, dy) < MIN_DRAG_PX) return;
				gesture.dragging = true;
			}
			updateOverlay(gesture, event);
			apply(gesture, event);
		},
		onRelease(event, gesture) {
			current = null;
			removeOverlay();
			if (gesture.dragging) apply(gesture, event);
			else replayClick(gesture, event);
		},
	});

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Escape" || !drag.isActive() || !current) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		const gesture = current;
		current = null;
		drag.cancel();
		removeOverlay();
		setSelection(gesture.leaf, gesture.selectedElementIds, gesture.selectedGroupIds);
	};
	win.addEventListener("keydown", onKeyDown, true);

	return () => {
		drag.dispose();
		removeOverlay();
		win.removeEventListener("keydown", onKeyDown, true);
	};
}
