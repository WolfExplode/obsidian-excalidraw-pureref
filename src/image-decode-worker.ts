import type { WorkerImageRequest } from "./image-worker-cache";

/** One worker per editor; encoded fetch and pixel decoding happen in its realm. */
export class ImageDecodeWorker {
	private worker: Worker;
	private sequence = 0;
	private disposed = false;
	private failure: Error | null = null;
	private pending = new Map<number, { resolve: (bitmap: ImageBitmap) => void; reject: (error: Error) => void }>();
	constructor(win: Window) {
		const owner = win as Window & typeof globalThis;
		const source = `self.onmessage = async ({data}) => {
			let bitmap;
			try {
				const blob = await (await fetch(data.dataURL)).blob();
				bitmap = await createImageBitmap(blob, { resizeWidth: data.width,
					...(data.height ? { resizeHeight: data.height } : {}), resizeQuality: 'high' });
				if (!data.height && bitmap.height > data.width) {
					const preview = await createImageBitmap(bitmap, { resizeWidth: Math.max(1, Math.round(bitmap.width * data.width / bitmap.height)),
						resizeHeight: data.width, resizeQuality: 'high' });
					bitmap.close(); bitmap = preview;
				}
				self.postMessage({ id: data.id, bitmap }, [bitmap]);
				bitmap = null;
			} catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
			finally { bitmap?.close(); }
		};`;
		const url = owner.URL.createObjectURL(new owner.Blob([source], { type: "text/javascript" }));
		try { this.worker = new owner.Worker(url); } finally { owner.URL.revokeObjectURL(url); }
		this.worker.onmessage = event => {
			const { id, bitmap, error } = event.data as { id: number; bitmap?: ImageBitmap; error?: string };
			const pending = this.pending.get(id); this.pending.delete(id);
			if (!pending || this.disposed) { bitmap?.close(); return; }
			if (bitmap) pending.resolve(bitmap); else pending.reject(new Error(error ?? "Worker returned no image"));
		};
		this.worker.onerror = event => {
			this.failure = new Error(event.message);
			this.worker.terminate();
			for (const pending of this.pending.values()) pending.reject(this.failure);
			this.pending.clear();
		};
	}
	decode(request: WorkerImageRequest): Promise<ImageBitmap> {
		if (this.disposed) return Promise.reject(new Error("Image worker disposed"));
		if (this.failure) return Promise.reject(this.failure);
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			try { this.worker.postMessage({ ...request, id }); }
			catch (error) { this.pending.delete(id); reject(error); }
		});
	}
	dispose(): void {
		this.disposed = true; this.worker.terminate();
		for (const pending of this.pending.values()) pending.reject(new Error("Image worker disposed"));
		this.pending.clear();
	}
}
