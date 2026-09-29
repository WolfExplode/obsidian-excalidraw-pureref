/**
 * Pure selection arithmetic behind the modifier-drag box deselect
 * (`deselect-drag.ts`): which selected elements a scene-space box catches, and
 * what the selection becomes once they are removed. Free of Obsidian/Excalidraw
 * imports so the test harness can exercise it directly.
 */
import { geometryOffset, type PackElement } from "./pack-elements";

export interface DeselectElement extends PackElement {
	/** Nested Excalidraw group ids, innermost first; the last id is the outermost group. */
	groupIds?: readonly string[];
}

/** An axis-aligned box in scene coordinates. */
export interface SceneBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Excalidraw's `boxSelectionMode`: "contain" needs the whole element inside, "overlap" any touch. */
export type BoxMode = "contain" | "overlap";

export interface SelectionState {
	selectedElementIds: Record<string, boolean>;
	selectedGroupIds: Record<string, boolean>;
}

export interface SubtractInput extends SelectionState {
	elements: readonly DeselectElement[];
	/** Non-null while the user is editing inside a group; its members are selected individually. */
	editingGroupId: string | null;
	box: SceneBox;
	mode: BoxMode;
}

type Point = readonly [number, number];

/** The four corners of an element's (possibly rotated) box, rotated about its center. */
export function elementCorners(el: PackElement): Point[] {
	const [offsetX, offsetY] = geometryOffset(el);
	const cx = el.x + offsetX + el.width / 2;
	const cy = el.y + offsetY + el.height / 2;
	const a = el.angle ?? 0;
	const cos = Math.cos(a);
	const sin = Math.sin(a);
	const hw = el.width / 2;
	const hh = el.height / 2;
	return [
		[-hw, -hh],
		[hw, -hh],
		[hw, hh],
		[-hw, hh],
	].map(([dx, dy]) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as const);
}

function project(points: readonly Point[], axis: Point): [number, number] {
	let min = Infinity;
	let max = -Infinity;
	for (const [x, y] of points) {
		const d = x * axis[0] + y * axis[1];
		min = Math.min(min, d);
		max = Math.max(max, d);
	}
	return [min, max];
}

/**
 * Whether the element's rotated box is caught by `box`. "overlap" is an exact
 * separating-axis test between the rotated rectangle and the box, so a rotated
 * image whose bounding box merely brushes the selection is not caught.
 */
export function elementInBox(el: PackElement, box: SceneBox, mode: BoxMode): boolean {
	const corners = elementCorners(el);
	if (mode === "contain") {
		return corners.every(([x, y]) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY);
	}
	const boxCorners: Point[] = [
		[box.minX, box.minY],
		[box.maxX, box.minY],
		[box.maxX, box.maxY],
		[box.minX, box.maxY],
	];
	const a = el.angle ?? 0;
	const axes: Point[] = [
		[1, 0],
		[0, 1],
		[Math.cos(a), Math.sin(a)],
		[-Math.sin(a), Math.cos(a)],
	];
	return axes.every((axis) => {
		const [minA, maxA] = project(corners, axis);
		const [minB, maxB] = project(boxCorners, axis);
		return maxA >= minB && maxB >= minA;
	});
}

/**
 * The group an element is selected through: its outermost group normally, or
 * the group one level inside `editingGroupId` while editing a group. Null when
 * the element is selected on its own.
 */
function selectionUnitGroup(el: DeselectElement, editingGroupId: string | null): string | null {
	const groupIds = el.groupIds ?? [];
	const depth = editingGroupId ? groupIds.indexOf(editingGroupId) : groupIds.length;
	if (depth <= 0) return null;
	return groupIds[depth - 1] ?? null;
}

/**
 * Removes every selected element the box catches from the selection. Groups
 * are treated as one unit, as Excalidraw selects them: catching any member
 * deselects the whole group. Text bound to a container leaves with it.
 */
export function subtractBoxFromSelection(input: SubtractInput): SelectionState {
	const selected = input.elements.filter((el) => !el.isDeleted && input.selectedElementIds[el.id]);

	const removed = new Set<string>();
	const removedGroups = new Set<string>();
	for (const el of selected) {
		if (!elementInBox(el, input.box, input.mode)) continue;
		removed.add(el.id);
		if (el.containerId) removed.add(el.containerId);
		const group = selectionUnitGroup(el, input.editingGroupId);
		if (group) removedGroups.add(group);
	}

	for (const el of selected) {
		if (el.groupIds?.some((group) => removedGroups.has(group))) removed.add(el.id);
		if (el.containerId && removed.has(el.containerId)) removed.add(el.id);
	}

	const selectedElementIds: Record<string, boolean> = {};
	for (const [id, on] of Object.entries(input.selectedElementIds)) {
		if (on && !removed.has(id)) selectedElementIds[id] = true;
	}
	// A group stays selected only while none of its members were removed.
	const brokenGroups = new Set<string>();
	for (const el of selected) {
		if (removed.has(el.id)) for (const group of el.groupIds ?? []) brokenGroups.add(group);
	}
	const selectedGroupIds: Record<string, boolean> = {};
	for (const [id, on] of Object.entries(input.selectedGroupIds)) {
		if (on && !brokenGroups.has(id)) selectedGroupIds[id] = true;
	}
	return { selectedElementIds, selectedGroupIds };
}
