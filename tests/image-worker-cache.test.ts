import { test } from "node:test";
import assert from "node:assert/strict";
import { WorkerImageCache, type WorkerImageRequest } from "../src/image-worker-cache";

const source = "data:image/jpeg;base64,/9j/one";
const other = "data:image/jpeg;base64,/9j/two";
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const bitmap = (width = 128, height = 128) => ({ width, height, closed: false, close() { this.closed = true; } });
function fixture(budget = 96 * 1024 * 1024) {
	const jobs: Array<{ request: WorkerImageRequest; resolve: (value: ReturnType<typeof bitmap>) => void }> = [];
	const changes: string[][] = [];
	const cache = new WorkerImageCache<ReturnType<typeof bitmap>>(budget,
		request => new Promise(resolve => jobs.push({ request, resolve })), (ids, retired) => {
			changes.push([...ids]); for (const bitmap of retired) bitmap.close();
		}, error => { throw error; });
	cache.setVisible(new Set(["a", "b"]));
	const get = (id = "a", pixels = 500, dataURL = source) => cache.get(id, dataURL, 1000, 1000, pixels, pixels);
	return { cache, jobs, changes, get };
}

test("pending source never falls through, active jobs are not duplicated, and ready tiers are reused", async () => {
	const { get, jobs, cache } = fixture();
	assert.equal(get(), null); assert.equal(jobs.length, 1);
	get(); get();
	const low = bitmap(); jobs[0].resolve(low); await flush();
	assert.equal(get(), low); assert.equal(jobs.length, 2);
	const high = bitmap(768, 768); jobs[1].resolve(high); await flush();
	assert.equal(get(), high);
	assert.equal(get("a", 100), low);
	assert.equal(get(), high); assert.equal(jobs.length, 2);
	assert.equal(cache.stats().completed, 2);
	cache.dispose(); assert.equal(low.closed, true); assert.equal(high.closed, true);
});

test("source replacement and disposal reject stale decoded pixels", async () => {
	const { get, jobs, cache } = fixture();
	get("a", 100); get("a", 100, other);
	const stale = bitmap(); jobs[0].resolve(stale); await flush();
	assert.equal(stale.closed, true); assert.equal(jobs.length, 2);
	cache.dispose(); const late = bitmap(); jobs[1].resolve(late); await flush();
	assert.equal(late.closed, true); assert.equal(cache.stats().bytes, 0);
});

test("memory pressure preserves visible previews and does not repeatedly regenerate blocked detail", async () => {
	const { get, jobs, cache } = fixture(128 * 128 * 4);
	get(); jobs[0].resolve(bitmap()); await flush();
	assert.equal(jobs.length, 1); // oversized 768px tier never dispatched
	assert.ok(get()); get(); await flush(); assert.equal(jobs.length, 1);
	assert.equal(cache.stats().budgetBlocked, 1);
	cache.dispose();
});

test("new visible previews have priority over queued higher detail, with unsupported sources native", async () => {
	const { get, jobs, cache } = fixture();
	get("a"); get("b"); jobs[0].resolve(bitmap()); await flush();
	assert.equal(jobs[1].request.fileId, "b"); assert.equal(jobs[1].request.tier, 0);
	assert.equal(get("c", 100, "data:image/gif;base64,GIF"), undefined);
	cache.dispose(); jobs[1].resolve(bitmap()); await flush();
});

test("off-screen Board previews survive detail pressure and reappear without decoding", async () => {
	const { cache, jobs, get } = fixture(768 * 768 * 4);
	cache.setBoard(new Map([["a", source], ["b", source], ["c", source]]));
	const a = bitmap(); jobs[0].resolve(a); await flush();
	jobs[1].resolve(bitmap()); await flush();
	jobs[2].resolve(bitmap()); await flush();
	assert.equal(cache.stats().previews, 3);
	assert.equal(cache.stats().queued, 0);
	get("a"); jobs[3].resolve(bitmap(768, 768)); await flush();
	cache.setVisible(new Set(["b"])); get("b");
	jobs[4].resolve(bitmap(768, 768)); await flush();
	assert.equal(a.closed, false);
	assert.equal(cache.stats().previews, 3);
	cache.setVisible(new Set(["a"]));
	assert.equal(get("a", 100), a);
	assert.equal(jobs.length, 5);
	cache.dispose();
});

test("visible detail takes priority over off-screen warming, removed sources release previews", async () => {
	const { cache, jobs, get } = fixture();
	cache.setBoard(new Map([["a", source], ["c", source]])); get("a");
	const a = bitmap(); jobs[0].resolve(a); await flush();
	assert.equal(jobs[1].request.fileId, "a"); assert.equal(jobs[1].request.tier, 768);
	jobs[1].resolve(bitmap(768, 768)); await flush();
	assert.equal(jobs[2].request.fileId, "c"); assert.equal(jobs[2].request.tier, 0);
	cache.setBoard(new Map([["c", source]])); assert.equal(a.closed, true);
	cache.dispose(); jobs[2].resolve(bitmap()); await flush();
});

test("preview resolution shrinks to fit the complete Board in its reserved allowance", async () => {
	const { cache, jobs } = fixture();
	cache.setBoard(new Map(Array.from({ length: 1025 }, (_, i) => [`image${i}`, source])));
	assert.equal(cache.stats().previewSize, 64);
	assert.equal(jobs[0].request.width, 64);
	cache.dispose(); jobs[0].resolve(bitmap(64, 64)); await flush();
});

test("zooming back out cancels queued sharp detail while retaining its preview", async () => {
	const { cache, jobs, get } = fixture();
	get("a", 900); get("a", 100);
	const low = bitmap(); jobs[0].resolve(low); await flush();
	assert.equal(jobs.length, 1);
	assert.equal(get("a", 100), low);
	get("a", 500); assert.equal(jobs[1].request.tier, 768);
	cache.dispose(); jobs[1].resolve(bitmap(768, 768)); await flush();
});

test("failed previews use the native fallback rather than leaving a permanent loading rectangle", async () => {
	let attempts = 0;
	const cache = new WorkerImageCache(1024 * 1024, async () => { attempts++; throw new Error("decode failed"); },
		() => {}, () => {});
	cache.setVisible(new Set(["a"]));
	assert.equal(cache.get("a", source, 1000, 1000, 100, 100), null);
	await flush();
	assert.equal(cache.get("a", source, 1000, 1000, 100, 100), undefined);
	assert.equal(attempts, 1);
	cache.dispose();
});
