/** Search metadata only; Excalidraw retains its native text/frame-name results. */
export interface BoardSearchCandidate {
	id: string;
	type: string;
	isDeleted?: boolean;
	link?: string | null;
	path?: string;
	originalLink?: string;
	hyperlink?: string | null;
	mimeType?: string;
}

export interface BoardSearchMatch {
	id: string;
	label: string;
	type: string;
}

function searchable(value: string): string {
	try { return decodeURIComponent(value).toLowerCase(); }
	catch { return value.toLowerCase(); }
}

export function matchBoardMetadata(candidates: readonly BoardSearchCandidate[], query: string): BoardSearchMatch[] {
	const needle = searchable(query.trim());
	if (!needle) return [];
	return candidates.filter(candidate => {
		if (candidate.isDeleted) return false;
		const values = [candidate.type, candidate.link, candidate.path, candidate.originalLink,
			candidate.hyperlink?.startsWith("data:") ? undefined : candidate.hyperlink, candidate.mimeType];
		// JPEG binaries without a source filename still support either common extension.
		if (candidate.mimeType === "image/jpeg") values.push(".jpg .jpeg");
		return values.some(value => value && searchable(value).includes(needle));
	}).map(candidate => ({
		id: candidate.id,
		type: candidate.type,
		label: candidate.path || candidate.originalLink || candidate.link ||
			(candidate.hyperlink?.startsWith("data:") ? undefined : candidate.hyperlink) ||
			candidate.mimeType || candidate.type,
	}));
}
