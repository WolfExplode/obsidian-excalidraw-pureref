import type { Plugin, WorkspaceLeaf } from "obsidian";

const active = new Set<() => void>();
const pendingPaints = new Set<() => void>();

/** Put feedback in the target Board's document, including chrome-free Popouts. */
export function beginBoardActivity(leaf: WorkspaceLeaf, label: string): () => void {
	const container = leaf.view.containerEl;
	let host = container.querySelector<HTMLElement>(":scope > .epr-board-activity");
	if (!host) {
		host = container.ownerDocument.createElement("div");
		host.className = "epr-board-activity";
		container.appendChild(host);
	}
	const row = container.ownerDocument.createElement("div");
	row.className = "epr-board-activity-row";
	row.setAttribute("role", "status");
	row.setAttribute("aria-live", "polite");
	const spinner = container.ownerDocument.createElement("span");
	spinner.className = "epr-board-activity-spinner";
	spinner.setAttribute("aria-hidden", "true");
	row.append(spinner, container.ownerDocument.createTextNode(label));
	host.appendChild(row);
	const finish = () => {
		row.remove();
		if (!host!.childElementCount) host!.remove();
		active.delete(finish);
	};
	active.add(finish);
	return finish;
}

/** Yield to an actual paint, not a guessed wall-clock settle delay. */
export async function paintBoardActivity(leaf: WorkspaceLeaf): Promise<void> {
	const doc = leaf.view.containerEl.ownerDocument;
	const win = doc.defaultView;
	if (!win || win.closed || doc.visibilityState === "hidden") return;
	await new Promise<void>(resolve => {
		let frame = 0;
		const finish = () => {
			win.cancelAnimationFrame(frame);
			doc.removeEventListener("visibilitychange", finish);
			win.removeEventListener("pagehide", finish);
			pendingPaints.delete(finish);
			resolve();
		};
		// Hidden/closed windows stop delivering frames. Release the rendering
		// yield so normal cancellation and finally cleanup can still run.
		doc.addEventListener("visibilitychange", finish);
		win.addEventListener("pagehide", finish);
		pendingPaints.add(finish);
		frame = win.requestAnimationFrame(() => { frame = win.requestAnimationFrame(finish); });
	});
}

export async function withBoardActivity<T>(leaf: WorkspaceLeaf, label: string, work: () => T | Promise<T>): Promise<T | undefined> {
	const view = leaf.view;
	const file = (view as unknown as { file?: unknown }).file;
	const finish = beginBoardActivity(leaf, label);
	try {
		await paintBoardActivity(leaf);
		if (!active.has(finish) || !view.containerEl.isConnected || leaf.view !== view || (view as unknown as { file?: unknown }).file !== file) return;
		return await work();
	} finally {
		finish();
	}
}

export function registerBoardActivityCleanup(plugin: Plugin): void {
	plugin.register(() => {
		for (const finish of [...active]) finish();
		for (const finish of [...pendingPaints]) finish();
	});
}
