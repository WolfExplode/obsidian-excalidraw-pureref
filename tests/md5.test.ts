import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { md5Hex } from "../src/md5";

describe("md5Hex", () => {
	it("matches the RFC 1321 test suite", () => {
		const text = (s: string) => md5Hex(new TextEncoder().encode(s));
		assert.equal(text(""), "d41d8cd98f00b204e9800998ecf8427e");
		assert.equal(text("abc"), "900150983cd24fb0d6963f7d28e17f72");
		assert.equal(text("message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
		assert.equal(text("12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
			"57edf4a22be3c955ac49da2e2107b67a");
	});

	it("matches Node's MD5 across padding boundaries", () => {
		for (const length of [55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70000]) {
			const data = Uint8Array.from({ length }, (_, i) => (i * 131 + 7) & 0xff);
			assert.equal(md5Hex(data), createHash("md5").update(data).digest("hex"), `length ${length}`);
		}
	});
});
