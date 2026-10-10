import { isJpegProxySource } from "./image-lod-policy";

export interface ProxyBitmap { width: number; height: number; close(): void }

export interface WorkerImageRequest {
	fileId: string; dataURL: string; tier: number; width: number; height: number;
}
interface Entry<T> extends WorkerImageRequest { bitmap: T; bytes: number }

/** Prepared pixel tiers, not canvases with deferred original-image commands. */
export class WorkerImageCache<T extends ProxyBitmap> {
	private entries = new Map<string, Entry<T>>();
	private byFile = new Map<string, Map<number, Entry<T>>>();
	private queue = new Map<string, WorkerImageRequest>();
	private sources = new Map<string, string>();
	private failed = new Map<string, string>();
	private blocked = new Map<string, string>();
	private visible = new Set<string>();
	private desiredDetail = new Map<string, number>();
	private bytes = 0;
	private previewBytes = 0;
	private previewSize = 128;
	private generation = 0;
	private running = false;
	private disposed = false;
	private completed = 0;
	private hits = 0;
	private active: WorkerImageRequest | null = null;
	private activeGeneration = 0;
	constructor(private budget: number, private decode: (request: WorkerImageRequest) => Promise<T>,
		private changed: (ids: ReadonlySet<string>, retired: T[]) => void,
		private error: (error: unknown) => void,
		private previewBudget = 64 * 1024 * 1024) {}

	/** Board-wide previews have their own allowance and survive detail eviction. */
	setBoard(sources: ReadonlyMap<string, string>): void {
		const jpeg = new Map([...sources].filter(([, source]) => isJpegProxySource(source)));
		const size = Math.min(128, Math.max(1, 2 ** Math.floor(Math.log2(Math.sqrt(this.previewBudget / (4 * Math.max(1, jpeg.size)))))));
		if (size < this.previewSize) { this.clear(); this.previewSize = size; }
		for (const [id, source] of this.sources) {
			if (jpeg.get(id) !== source) this.replaceSource(id, jpeg.get(id));
		}
		for (const [id, source] of jpeg) {
			if (this.sources.get(id) !== source) this.replaceSource(id, source);
			this.enqueuePreview(id, source);
		}
		void this.pump();
	}
	private replaceSource(fileId: string, dataURL?: string): void {
		this.desiredDetail.delete(fileId);
		const retired: T[] = [];
		for (const [key, entry] of this.entries) if (entry.fileId === fileId) {
			this.drop(key, entry); retired.push(entry.bitmap);
		}
		for (const [key, req] of this.queue) if (req.fileId === fileId) this.queue.delete(key);
		for (const key of this.failed.keys()) if (key.startsWith(`${fileId}:`)) this.failed.delete(key);
		for (const key of this.blocked.keys()) if (key.startsWith(`${fileId}:`)) this.blocked.delete(key);
		if (dataURL) this.sources.set(fileId, dataURL); else this.sources.delete(fileId);
		if (retired.length) this.changed(new Set([fileId]), retired);
	}
	private enqueuePreview(fileId: string, dataURL: string): void {
		const key = `${fileId}:0`;
		if (this.entries.has(key) || this.failed.get(key) === dataURL || this.blocked.get(key) === dataURL ||
			(this.activeGeneration === this.generation && this.active?.fileId === fileId && this.active.tier === 0 && this.active.dataURL === dataURL)) return;
		// A zero height asks the worker to discover the aspect ratio without renderer work.
		this.queue.set(key, { fileId, dataURL, tier: 0, width: this.previewSize, height: 0 });
	}

	/** null is a loading preview; undefined is an explicit unsupported/failed native fallback. */
	get(fileId: string, dataURL: string, naturalWidth: number, naturalHeight: number,
		pixelWidth: number, pixelHeight: number): T | null | undefined {
		if (this.disposed || !isJpegProxySource(dataURL) || !(naturalWidth > 0 && naturalHeight > 0)) return undefined;
		const needed = Math.max(pixelWidth, pixelHeight);
		const tier = [128, 320, 768, 1600, 3200, 6400].find(size => size >= needed);
		if (!tier || !Number.isFinite(needed)) return undefined;
		if (this.sources.get(fileId) !== dataURL) this.replaceSource(fileId, dataURL);
		const key = `${fileId}:${tier}`;
		if (this.desiredDetail.get(fileId) !== tier) {
			this.desiredDetail.set(fileId, tier);
			for (const [queuedKey, request] of this.queue) {
				if (request.fileId === fileId && request.tier !== 0 && request.tier !== tier) this.queue.delete(queuedKey);
			}
		}
		const ready = [...(this.byFile.get(fileId)?.values() ?? [])];
		const adequate = ready.filter(e => e.tier >= tier || (e.tier === 0 && Math.max(e.bitmap.width, e.bitmap.height) >= Math.min(needed, Math.max(naturalWidth, naturalHeight)))).sort((a, b) => a.tier - b.tier)[0];
		const preview = adequate ?? ready.sort((a, b) => b.tier - a.tier)[0];
		if (!preview && this.failed.get(`${fileId}:0`) === dataURL) return undefined;
		if (this.failed.get(key) === dataURL) return preview?.bitmap ?? undefined;
		if (preview) {
			this.hits++;
			const entryKey = `${fileId}:${preview.tier}`;
			this.entries.delete(entryKey); this.entries.set(entryKey, preview);
		}
		this.enqueuePreview(fileId, dataURL);
		if (!adequate && needed > this.previewSize && this.blocked.get(key) !== dataURL) {
			// Detail uses its own allowance; a retained preview stays drawable meanwhile.
			for (const size of [tier]) {
				const requestKey = `${fileId}:${size}`;
				if (this.activeGeneration === this.generation && this.active?.fileId === fileId && this.active.tier === size && this.active.dataURL === dataURL) continue;
				if (this.entries.has(requestKey) || this.failed.get(requestKey) === dataURL || this.blocked.get(requestKey) === dataURL) continue;
				const ratio = Math.min(1, size / Math.max(naturalWidth, naturalHeight));
				const width = Math.max(1, Math.round(naturalWidth * ratio));
				const height = Math.max(1, Math.round(naturalHeight * ratio));
				if (width * height * 4 > this.budget) { this.blocked.set(requestKey, dataURL); continue; }
				this.queue.set(requestKey, { fileId, dataURL, tier: size, width, height });
			}
		}
		void this.pump();
		return preview?.bitmap ?? null;
	}

	/** Cull detail work; Board previews remain queued even when off screen. */
	setVisible(ids: ReadonlySet<string>): void {
		if (ids.size !== this.visible.size || [...ids].some(id => !this.visible.has(id))) this.blocked.clear();
		this.visible = new Set(ids);
		for (const [key, req] of this.queue) if (req.tier !== 0 && !ids.has(req.fileId)) this.queue.delete(key);
		for (const id of this.desiredDetail.keys()) if (!ids.has(id)) this.desiredDetail.delete(id);
	}

	clear(): void {
		this.generation++;
		const retired = [...this.entries.values()].map(e => e.bitmap);
		const ids = new Set(this.sources.keys());
		this.entries.clear(); this.byFile.clear(); this.queue.clear(); this.sources.clear(); this.failed.clear(); this.blocked.clear(); this.desiredDetail.clear(); this.bytes = 0; this.previewBytes = 0;
		this.changed(ids, retired);
	}
	dispose(): void { this.disposed = true; this.clear(); }
	stats() { return { proxies: this.entries.size, bytes: this.bytes + this.previewBytes,
		previewBytes: this.previewBytes, detailBytes: this.bytes, previewSize: this.previewSize,
		previews: [...this.entries.values()].filter(entry => entry.tier === 0).length,
		boardImages: this.sources.size, queued: this.queue.size,
		running: this.running, completed: this.completed, hits: this.hits, failed: this.failed.size, budgetBlocked: this.blocked.size }; }
	private drop(key: string, entry: Entry<T>): void {
		this.entries.delete(key); if (entry.tier === 0) this.previewBytes -= entry.bytes; else this.bytes -= entry.bytes;
		const file = this.byFile.get(entry.fileId);
		file?.delete(entry.tier);
		if (!file?.size) this.byFile.delete(entry.fileId);
	}

	private async pump(): Promise<void> {
		if (this.running || this.disposed) return;
		this.running = true;
		try {
			while (this.queue.size && !this.disposed) {
				const queued = [...this.queue];
				const [key, req] = queued.find(([, r]) => r.tier === 0 && this.visible.has(r.fileId)) ??
					queued.find(([, r]) => this.visible.has(r.fileId)) ?? queued[0];
				this.queue.delete(key);
				this.active = req;
				const generation = this.generation;
				this.activeGeneration = generation;
				let bitmap: T | null = null;
				try {
					bitmap = await this.decode(req);
					if (this.disposed || generation !== this.generation || this.sources.get(req.fileId) !== req.dataURL) continue;
					if (req.tier !== 0 && !this.visible.has(req.fileId)) continue;
					const cost = bitmap.width * bitmap.height * 4;
					const evict: string[] = [];
					const limit = req.tier === 0 ? this.previewBudget : this.budget;
					let available = limit - (req.tier === 0 ? this.previewBytes : this.bytes);
					for (const [entryKey, entry] of this.entries) {
						if (available >= cost) break;
						if (req.tier === 0 || entry.tier === 0) continue;
						available += entry.bytes; evict.push(entryKey);
					}
					if (!(cost > 0) || cost > limit || available < cost) { this.blocked.set(key, req.dataURL); continue; }
					const retired: T[] = [];
					const ids = new Set([req.fileId]);
					for (const entryKey of evict) {
						const entry = this.entries.get(entryKey)!;
						this.drop(entryKey, entry);
						retired.push(entry.bitmap); ids.add(entry.fileId);
						// Suppress repeated eviction/regeneration while this viewport is stable.
						this.blocked.set(entryKey, entry.dataURL);
					}
					const old = this.entries.get(key);
					if (old) { this.drop(key, old); retired.push(old.bitmap); }
					const entry = { ...req, bitmap, bytes: cost };
					this.entries.set(key, entry); if (req.tier === 0) this.previewBytes += cost; else this.bytes += cost;
					let file = this.byFile.get(req.fileId);
					if (!file) { file = new Map(); this.byFile.set(req.fileId, file); }
					file.set(req.tier, entry);
					bitmap = null; this.completed++;
					this.changed(ids, retired);
				} catch (error) {
					if (!this.disposed && generation === this.generation && this.sources.get(req.fileId) === req.dataURL) {
						this.failed.set(key, req.dataURL); this.error(error); this.changed(new Set([req.fileId]), []);
					}
				} finally { bitmap?.close(); this.active = null; }
			}
		} finally { this.running = false; }
	}
}
