import type { PluginDataWriter } from "./plugin-data-writer";

/** The preference is durable; worker pixels and renderer callbacks are view-owned. */
export class ImageNavigationSettings {
	private enabled = true;
	private listeners = new Set<() => void>();
	constructor(private readonly writer: PluginDataWriter) {}
	async load(): Promise<void> {
		const stored = await this.writer.readSection<{ enabled?: unknown }>("imageNavigation");
		this.enabled = typeof stored?.enabled === "boolean" ? stored.enabled : true;
	}
	getEnabled(): boolean { return this.enabled; }
	async setEnabled(enabled: boolean): Promise<void> {
		await this.writer.mutateSection("imageNavigation", () => ({ enabled }));
		this.enabled = enabled;
		for (const listener of this.listeners) listener();
	}
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
}
