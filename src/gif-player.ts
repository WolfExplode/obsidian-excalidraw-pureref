/** Native GIF decoding, independent of Obsidian. Frames are released after drawing. */
export interface GifFrame {
	displayWidth: number;
	displayHeight: number;
	duration: number | null;
	close(): void;
}
export interface GifDecoder {
	tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
	decode(options: { frameIndex: number }): Promise<{ image: GifFrame }>;
	close(): void;
}
export type GifDecoderConstructor = new (options: { data: ArrayBuffer; type: string }) => GifDecoder;

export class GifPlayer {
	frameCount = 0;
	frame = 0;
	duration = 100;
	playing = true;
	speed = 1;
	private wanted = 0;
	private rendering: Promise<void> | null = null;
	private disposed = false;
	private due = Infinity;

	constructor(private decoder: GifDecoder, private canvas: HTMLCanvasElement,
		private changed: () => void, private now: () => number) {}

	async init(): Promise<void> {
		await this.decoder.tracks.ready;
		if (this.disposed) return;
		this.frameCount = this.decoder.tracks.selectedTrack?.frameCount ?? 0;
		if (!this.frameCount) throw new Error("GIF has no decodable frames");
		await this.seek(0);
	}

	seek(index: number): Promise<void> {
		if (this.disposed) return Promise.resolve();
		this.wanted = Math.max(0, Math.min(this.frameCount - 1, Math.round(index)));
		if (!this.rendering) this.rendering = this.render().finally(() => { this.rendering = null; });
		return this.rendering;
	}

	private async render(): Promise<void> {
		while (!this.disposed) {
			const index = this.wanted;
			const { image } = await this.decoder.decode({ frameIndex: index });
			try {
				if (this.disposed) return;
				if (index !== this.wanted) continue; // A newer scrub request owns the pixels.
				this.canvas.width = image.displayWidth;
				this.canvas.height = image.displayHeight;
				const ctx = this.canvas.getContext("2d");
				if (!ctx) throw new Error("Unable to create GIF frame canvas");
				ctx.drawImage(image as unknown as CanvasImageSource, 0, 0);
				this.frame = index;
				this.duration = image.duration && image.duration > 0 ? image.duration / 1000 : 100;
				this.due = this.now() + this.duration / this.speed;
				this.changed();
				if (index === this.wanted) return;
			} finally { image.close(); }
		}
	}

	toggle(): void {
		this.playing = !this.playing;
		this.due = this.now() + this.duration / this.speed;
		this.changed();
	}
	setSpeed(speed: number): void {
		this.speed = speed;
		this.due = this.now() + this.duration / speed;
	}
	step(delta: number): Promise<void> {
		this.playing = false;
		return this.seek((this.wanted + delta + this.frameCount) % this.frameCount);
	}
	async tick(time: number): Promise<void> {
		if (this.playing && !this.rendering && time >= this.due) await this.seek((this.frame + 1) % this.frameCount);
	}
	async snapshot(): Promise<Blob> {
		this.playing = false;
		await this.rendering;
		if (this.disposed) throw new Error("GIF controls closed during extraction");
		this.changed();
		return new Promise((resolve, reject) => this.canvas.toBlob(
			blob => blob ? resolve(blob) : reject(new Error("Unable to encode GIF frame")), "image/png"));
	}
	dispose(): void {
		this.disposed = true;
		this.decoder.close();
	}
}
