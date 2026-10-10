/** Formats Excalidraw can load as images without an Obsidian embed renderer. */
const IMAGE_MIME: Readonly<Record<string, string>> = {
	png: "image/png", apng: "image/png",
	jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg",
	gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
	svg: "image/svg+xml", avif: "image/avif", ico: "image/x-icon",
};

export function pureRefImageMime(format: string): string | null {
	return IMAGE_MIME[format.toLowerCase()] ?? null;
}

/** Preserve extended formats for registered Obsidian embeds, with a safe suffix. */
export function pureRefImageExtension(format: string): string {
	const normalized = format.toLowerCase();
	if (normalized === "jpeg" || normalized === "jfif") return "jpg";
	if (normalized === "apng") return "png";
	return /^[a-z0-9]+$/.test(normalized) ? normalized : "bin";
}
