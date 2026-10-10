/** Native insertion payload: retain the host's image registry and insertion flags. */
export interface ImageInsertRequest {
	newElements: Array<{
		id: string;
		type: string;
		fileId?: string | null;
		isDeleted?: boolean;
		groupIds?: readonly string[];
		frameId?: string | null;
		boundElements?: readonly unknown[] | null;
	}>;
	images?: Record<string, { file?: string | { path: string } | null }>;
	repositionToCursor?: boolean;
	save?: boolean;
	newElementsOnTop?: boolean;
	shouldRestoreElements?: boolean;
	captureUpdate?: unknown;
}

interface InsertView {
	addElements(request: ImageInsertRequest): Promise<boolean>;
}

const KNOWN_FLAGS = new Set([
	"newElements", "images", "repositionToCursor", "save", "newElementsOnTop",
	"shouldRestoreElements", "captureUpdate",
]);

/**
 * Coalesce plain imported images at the rendering boundary, then let the native
 * insertion own registration, history and saving. No import-completion timeout:
 * every scheduled flush commits whatever is ready, including partial imports.
 */
export function attachImageImportBatch(
	view: InsertView,
	options: {
		matches(path: string, id: string): boolean;
		schedule(flush: () => void): () => void;
		onBatch?(requests: number, elements: number): void;
	},
): { flush(): void; detach(): void } {
	const original = view.addElements;
	const hadOwn = Object.prototype.hasOwnProperty.call(view, "addElements");
	let pending: Array<{
		request: ImageInsertRequest;
		resolve(value: boolean): void;
		reject(error: unknown): void;
	}> = [];
	let cancel: (() => void) | null = null;
	let generation = 0;

	const eligible = (request: ImageInsertRequest): boolean => {
		if (Object.keys(request).some((key) => !KNOWN_FLAGS.has(key))) return false;
		if (request.repositionToCursor || request.shouldRestoreElements || !request.save) return false;
		return request.newElements.length > 0 && request.newElements.every((element) => {
			if (element.type !== "image" || element.isDeleted || element.frameId ||
				element.groupIds?.length || element.boundElements?.length || !element.fileId) return false;
			const file = request.images?.[element.fileId]?.file;
			const path = typeof file === "string" ? file : file?.path;
			return !!path && options.matches(path, element.id);
		});
	};

	const compatible = (a: ImageInsertRequest, b: ImageInsertRequest): boolean =>
		!!a.newElementsOnTop === !!b.newElementsOnTop && a.captureUpdate === b.captureUpdate;

	const flush = () => {
		generation++;
		cancel?.();
		cancel = null;
		const batch = pending;
		pending = [];
		if (!batch.length) return;
		const first = batch[0].request;
		// Native prepend calls put the last insertion at the front. Preserve that
		// same order when combining them, including each call's internal order.
		const ordered = first.newElementsOnTop ? batch : [...batch].reverse();
		const request: ImageInsertRequest = {
			...first,
			newElements: ordered.flatMap((item) => item.request.newElements),
			images: Object.assign({}, ...batch.map((item) => item.request.images)),
		};
		try {
			const result = original.call(view, request);
			options.onBatch?.(batch.length, request.newElements.length);
			void Promise.resolve(result).then(
				(value) => { for (const item of batch) item.resolve(value); },
				(error) => { for (const item of batch) item.reject(error); },
			);
		} catch (error) {
			for (const item of batch) item.reject(error);
		}
	};

	const wrapped = function (this: InsertView, request: ImageInsertRequest): Promise<boolean> {
		if (this !== view || !eligible(request)) {
			flush();
			return original.call(this, request);
		}
		if (pending.length && !compatible(pending[0].request, request)) flush();
		// Never merge two updates of one element as though they were insertions.
		const queuedIds = new Set(pending.flatMap((item) => item.request.newElements.map((element) => element.id)));
		if (request.newElements.some((element) => queuedIds.has(element.id))) flush();
		const result = new Promise<boolean>((resolve, reject) => {
			pending.push({ request: { ...request, newElements: [...request.newElements], images: { ...request.images } }, resolve, reject });
		});
		if (!cancel) {
			const scheduledGeneration = generation;
			cancel = options.schedule(() => { if (generation === scheduledGeneration) flush(); });
		}
		return result;
	};
	view.addElements = wrapped;
	return {
		flush,
		detach: () => {
			// Disabling the host plugin must not discard images already accepted
			// from the native importer. Submit queued work before removing the hook.
			flush();
			if (view.addElements === wrapped) {
				if (hadOwn) view.addElements = original;
				else delete (view as Partial<InsertView>).addElements;
			}
		},
	};
}
