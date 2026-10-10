import assert from "node:assert/strict";
import { test } from "node:test";
import { GifPlayer, type GifDecoder, type GifFrame } from "../src/gif-player";

function fixture() {
	const drawn: number[] = [], closed: number[] = [], requested: number[] = [];
	let time = 0, decoderClosed = false;
	let blocked: { index: number; resolve: (value: { image: GifFrame }) => void } | null = null;
	let defer = false;
	const frame = (index: number): GifFrame => ({ displayWidth: 10, displayHeight: 20,
		duration: (index + 1) * 100000, close: () => closed.push(index) });
	const decoder: GifDecoder = {
		tracks: { ready: Promise.resolve(), selectedTrack: { frameCount: 4 } },
		decode({ frameIndex }) {
			requested.push(frameIndex);
			if (defer) return new Promise(resolve => { blocked = { index: frameIndex, resolve }; });
			return Promise.resolve({ image: frame(frameIndex) });
		},
		close() { decoderClosed = true; },
	};
	const canvas = { width: 0, height: 0,
		getContext: () => ({ drawImage: () => drawn.push(requested[requested.length - 1]) }),
		toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["png"])),
	} as unknown as HTMLCanvasElement;
	const player = new GifPlayer(decoder, canvas, () => {}, () => time);
	return { player, drawn, closed, requested, canvas,
		time: (value: number) => { time = value; },
		defer: () => { defer = true; },
		complete() { const pending = blocked!; defer = false; pending.resolve({ image: frame(pending.index) }); },
		decoderClosed: () => decoderClosed };
}

test("GIF playback uses individual durations and speed; stepping wraps and pauses", async () => {
	const f = fixture(); await f.player.init();
	assert.deepEqual(f.closed, [0]);
	f.time(99); await f.player.tick(99); assert.equal(f.player.frame, 0);
	f.time(100); await f.player.tick(100); assert.equal(f.player.frame, 1);
	f.player.setSpeed(2);
	f.time(199); await f.player.tick(199); assert.equal(f.player.frame, 1);
	f.time(200); await f.player.tick(200); assert.equal(f.player.frame, 2);
	await f.player.seek(0); await f.player.step(-1);
	assert.equal(f.player.frame, 3); assert.equal(f.player.playing, false);
	assert.equal(f.canvas.width, 10); assert.equal(f.canvas.height, 20);
	f.player.dispose(); assert.equal(f.decoderClosed(), true);
});

test("rapid scrubbing renders the latest request and closes superseded decoded frames", async () => {
	const f = fixture(); await f.player.init(); f.defer();
	const pending = f.player.seek(1);
	void f.player.seek(2); void f.player.seek(3);
	f.complete(); await pending;
	assert.equal(f.player.frame, 3);
	assert.deepEqual(f.drawn, [0, 3]);
	assert.deepEqual(f.closed, [0, 1, 3]);
});

test("closing during decoding releases the late frame without drawing it", async () => {
	const f = fixture(); await f.player.init(); f.defer();
	const pending = f.player.seek(1); f.player.dispose(); f.complete(); await pending;
	assert.deepEqual(f.drawn, [0]); assert.deepEqual(f.closed, [0, 1]);
	await assert.rejects(f.player.snapshot(), /closed/);
});

test("extraction waits for the pending scrub and pauses the displayed frame", async () => {
	const f = fixture(); await f.player.init(); f.defer();
	void f.player.seek(2); const snapshot = f.player.snapshot(); f.complete();
	assert.equal((await snapshot).size, 3);
	assert.equal(f.player.frame, 2); assert.equal(f.player.playing, false);
});
