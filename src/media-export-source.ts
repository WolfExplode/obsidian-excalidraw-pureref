/** Excalidraw external images have a hyperlink and loaded pixels, but no vault file. */
export interface ExportImageRecord<File> {
	file?: File | null;
	hyperlink?: string | null;
	getImage?(isDark: boolean): string;
}

export type ImageExportSource<File> =
	| { kind: "vault"; file: File; dataURL?: string }
	| { kind: "external"; url?: string; dataURL?: string };

export function resolveImageExportSource<File>(
	record: ExportImageRecord<File> | undefined,
	loadedDataURL: string | undefined,
): ImageExportSource<File> | null {
	const dataURL = loadedDataURL || record?.getImage?.(false) || undefined;
	if (record?.file) return { kind: "vault", file: record.file, dataURL };
	const url = record?.hyperlink || undefined;
	return url || dataURL ? { kind: "external", url, dataURL } : null;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
	"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
	"image/webp": "webp", "image/svg+xml": "svg", "image/avif": "avif",
	"image/bmp": "bmp", "image/tiff": "tiff", "image/x-icon": "ico",
};

/** URL queries/fragments and Windows-invalid characters never become export filenames. */
export function externalImageExportName(url: string | undefined, mimeType: string, fileId: string): string {
	let name = "";
	try {
		name = decodeURIComponent(new URL(url ?? "").pathname.split("/").pop() ?? "");
	} catch { /* An anonymous loaded binary still has a usable fallback name. */ }
	name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "");
	if (!name || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `image-${fileId}`;
	const extension = IMAGE_EXTENSIONS[mimeType.toLowerCase().split(";")[0].trim()];
	if (extension && !/\.[a-z0-9]+$/i.test(name)) name += `.${extension}`;
	return name;
}

export function decodeImageDataURL(dataURL: string): { bytes: Uint8Array; mimeType: string } {
	const match = /^data:([^;,]+)((?:;[^,]*)?),(.*)$/s.exec(dataURL);
	if (!match) throw new Error("External image pixels are not a data URL");
	const payload = decodeURIComponent(match[3]);
	const bytes = /;base64(?:;|$)/i.test(match[2])
		? Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
		: new TextEncoder().encode(payload);
	return { bytes, mimeType: match[1] };
}
