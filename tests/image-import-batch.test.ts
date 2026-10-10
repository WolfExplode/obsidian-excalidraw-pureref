import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachImageImportBatch, type ImageInsertRequest } from "../src/image-import-batch";

function image(id: string, onTop = true): ImageInsertRequest {
	return {
		newElements: [{ id, type: "image", fileId: `file-${id}` }],
		images: { [`file-${id}`]: { file: `attachments/${id}.png` } },
		save: true,
		newElementsOnTop: onTop,
	};
}

function fixture(commit?: (request: ImageInsertRequest) => Promise<boolean>) {
	const calls: ImageInsertRequest[] = [];
	const scheduled: Array<() => void> = [];
	const original = (request: ImageInsertRequest) => {
		calls.push(request);
		return commit?.(request) ?? Promise.resolve(true);
	};
	const view = { addElements: original };
	const batch = attachImageImportBatch(view, {
		matches: (path) => path.startsWith("attachments/"),
		schedule: (callback) => { scheduled.push(callback); return () => {}; },
	});
	return { view, batch, calls, scheduled, original };
}

describe("image import insertion batching", () => {
	it("registers one native insertion and waits for its save before resolving every caller", async () => {
		let finish!: (value: boolean) => void;
		const f = fixture(() => new Promise((resolve) => { finish = resolve; }));
		let resolved = false;
		const first = f.view.addElements(image("one")).then((value) => { resolved = true; return value; });
		const second = f.view.addElements(image("two"));
		assert.equal(f.calls.length, 0);
		assert.equal(f.scheduled.length, 1);
		f.scheduled[0]();
		assert.equal(f.calls.length, 1);
		assert.deepEqual(f.calls[0].newElements.map((el) => el.id), ["one", "two"]);
		assert.deepEqual(Object.keys(f.calls[0].images!), ["file-one", "file-two"]);
		await Promise.resolve();
		assert.equal(resolved, false);
		finish(true);
		assert.deepEqual(await Promise.all([first, second]), [true, true]);
	});

	it("preserves native prepend ordering and each request's internal order", async () => {
		const f = fixture();
		const first = image("one", false);
		first.newElements.push({ id: "extra", type: "image", fileId: "file-one" });
		const results = [f.view.addElements(first), f.view.addElements(image("two", false))];
		f.batch.flush();
		assert.deepEqual(f.calls[0].newElements.map((el) => el.id), ["two", "one", "extra"]);
		await Promise.all(results);
	});

	it("flushes before unsupported insertions and never merges capture or stacking policies", async () => {
		const f = fixture();
		const results = [f.view.addElements(image("one")), f.view.addElements(image("two", false))];
		const third = image("three", false);
		third.captureUpdate = "NEVER";
		results.push(f.view.addElements(third));
		const text = { newElements: [{ id: "text", type: "text" }], save: true };
		results.push(f.view.addElements(text));
		assert.deepEqual(f.calls.map((call) => call.newElements[0].id), ["one", "two", "three", "text"]);
		await Promise.all(results);
	});

	it("leaves existing files, relationship-aware insertions, cursor placement and future flags native", async () => {
		const f = fixture();
		const requests = [image("existing"), image("grouped"), image("framed"), image("bound"), image("cursor"), image("future")];
		requests[0].images!["file-existing"].file = "existing/one.png";
		requests[1].newElements[0].groupIds = ["group"];
		requests[2].newElements[0].frameId = "frame";
		requests[3].newElements[0].boundElements = [{ id: "arrow" }];
		requests[4].repositionToCursor = true;
		Object.assign(requests[5], { futureFlag: true });
		await Promise.all(requests.map((request) => f.view.addElements(request)));
		assert.equal(f.calls.length, requests.length);
		assert.equal(f.scheduled.length, 0);
		for (let i = 0; i < requests.length; i++) assert.equal(f.calls[i], requests[i]);
	});

	it("does not duplicate an element when a second insertion uses its id", async () => {
		const f = fixture();
		const results = [f.view.addElements(image("one")), f.view.addElements(image("one"))];
		f.batch.flush();
		assert.equal(f.calls.length, 2);
		assert.ok(f.calls.every((request) => request.newElements.length === 1));
		await Promise.all(results);
	});

	it("ignores stale callbacks after an explicit flush and commits queued work on detach", async () => {
		const f = fixture();
		const first = f.view.addElements(image("one"));
		f.batch.flush();
		const second = f.view.addElements(image("two"));
		f.scheduled[0]();
		assert.equal(f.calls.length, 1);
		f.batch.detach();
		assert.equal(f.calls.length, 2);
		assert.equal(f.view.addElements, f.original);
		f.scheduled[1]();
		assert.equal(f.calls.length, 2);
		await Promise.all([first, second]);
	});

	it("propagates native rejection or a false commit to every caller", async () => {
		for (const reject of [true, false]) {
			const error = new Error("native save failed");
			const f = fixture(() => reject ? Promise.reject(error) : Promise.resolve(false));
			const results = Promise.allSettled([f.view.addElements(image("one")), f.view.addElements(image("two"))]);
			f.batch.flush();
			for (const result of await results) {
				if (reject) { assert.equal(result.status, "rejected"); if (result.status === "rejected") assert.equal(result.reason, error); }
				else { assert.equal(result.status, "fulfilled"); if (result.status === "fulfilled") assert.equal(result.value, false); }
			}
		}
	});
});
