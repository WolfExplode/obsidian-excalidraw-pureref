/** Image identity fields; geometry and placement do not affect source identity. */
export interface DuplicateImageCandidate {
	id: string;
	type: string;
	isDeleted?: boolean;
	fileId?: string | null;
	crop?: { width: number; height: number } | null;
	customData?: Record<string, unknown>;
}

export function imageDuplicateSignature(
	element: DuplicateImageCandidate, cropKey: string, treatCropsAsDuplicates: boolean,
): string | null {
	if (element.type !== "image" || !element.fileId) return null;
	if (treatCropsAsDuplicates) {
		const crop = element.customData?.[cropKey];
		const source = crop && typeof crop === "object" ? (crop as { sourceFileId?: unknown }).sourceFileId : undefined;
		return `image:${typeof source === "string" && source ? source : element.fileId}`;
	}
	const round = (value: number | undefined) => value === undefined ? "" : String(Math.round(value * 100) / 100);
	return `image:${element.fileId}:${round(element.crop?.width)}x${round(element.crop?.height)}`;
}

/** Keep every member of repeated source groups inside the current selection only. */
export function selectedImagesWithDuplicates(
	elements: readonly DuplicateImageCandidate[], selectedIds: Readonly<Record<string, boolean>>,
	cropKey: string, treatCropsAsDuplicates: boolean,
): string[] {
	const selected = elements.filter(element => !element.isDeleted && selectedIds[element.id] && element.type === "image");
	const keyed = selected.map(element => ({
		id: element.id, signature: imageDuplicateSignature(element, cropKey, treatCropsAsDuplicates),
	}));
	const counts = new Map<string, number>();
	for (const { signature } of keyed) {
		if (signature) counts.set(signature, (counts.get(signature) ?? 0) + 1);
	}
	return keyed.filter(({ signature }) => signature && counts.get(signature)! > 1).map(({ id }) => id);
}
