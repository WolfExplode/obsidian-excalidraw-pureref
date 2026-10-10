interface ImportRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Translate staged images and measured notes together, preserving their layout and size. */
export function centerPureRefImport(elements: readonly ImportRect[], target: { x: number; y: number }): void {
	if (elements.length === 0) return;
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const element of elements) {
		minX = Math.min(minX, element.x);
		minY = Math.min(minY, element.y);
		maxX = Math.max(maxX, element.x + element.width);
		maxY = Math.max(maxY, element.y + element.height);
	}
	const dx = target.x - (minX + (maxX - minX) / 2);
	const dy = target.y - (minY + (maxY - minY) / 2);
	for (const element of elements) {
		element.x += dx;
		element.y += dy;
	}
}
