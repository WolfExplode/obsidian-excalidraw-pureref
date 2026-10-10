import type { ImageCrop } from "./crop-geometry";

export interface LodImage {
	x: number; y: number; width: number; height: number; angle?: number;
	crop?: ImageCrop | null;
}
export interface LodViewport {
	scrollX: number; scrollY: number; width: number; height: number;
	zoom: { value: number };
}

/** MIME labels can be stale; JPEG bytes begin FF D8 FF (base64 /9j/). */
export function isJpegProxySource(dataURL: string): boolean {
	return /^data:image\/(?:jpeg|jpg|jfif|pjpeg);base64,\/9j\//.test(dataURL);
}

/** Public releases without the display-readiness seam keep their native renderer. */
export function hasImageNavigationSupport(api: {
	setImageRenderSourceProvider?: unknown; refreshImageRenderSources?: unknown;
} | null): boolean {
	return typeof api?.setImageRenderSourceProvider === "function" && typeof api.refreshImageRenderSources === "function";
}

/** Conservative rotated bounds; false positives cost work, false negatives hide detail. */
export function isLodImageVisible(image: LodImage, view: LodViewport): boolean {
	const zoom = view.zoom.value;
	if (!(zoom > 0 && view.width > 0 && view.height > 0)) return false;
	const c = Math.abs(Math.cos(image.angle ?? 0));
	const s = Math.abs(Math.sin(image.angle ?? 0));
	const halfW = (image.width * c + image.height * s) / 2;
	const halfH = (image.width * s + image.height * c) / 2;
	const cx = image.x + image.width / 2 + view.scrollX;
	const cy = image.y + image.height / 2 + view.scrollY;
	return cx + halfW >= 0 && cy + halfH >= 0 &&
		cx - halfW <= view.width / zoom && cy - halfH <= view.height / zoom;
}
