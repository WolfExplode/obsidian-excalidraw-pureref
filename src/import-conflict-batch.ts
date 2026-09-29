/**
 * Applies Excalidraw's "Use" collision choice to the other files in one drop.
 * The community plugin creates a separate GenericSuggester for each file, so
 * this observes only that exact prompt and clicks its existing choice. It does
 * not replace the import pipeline or change how the attachment is resolved.
 */

const TITLE_PREFIX = "A file with the same name/path already exists in the Vault";
const USE_CHOICE = "Use the file already in the Vault instead of importing";

interface DropBatch {
	names: Set<string>;
	useExistingForAll: boolean;
}

// Obsidian may render a Popout's suggester in the main document. Both document
// listeners therefore share the current drop while retaining their own DOM hooks.
let activeBatch: DropBatch | null = null;
const scanners = new Set<() => void>();

function basename(path: string): string {
	return path.replace(/\\/g, "/").split("/").pop() ?? "";
}

function choices(modal: HTMLElement): HTMLElement[] {
	return Array.from(modal.querySelectorAll<HTMLElement>(".suggestion-item"));
}

function isConflictPrompt(modal: HTMLElement, batch: DropBatch): boolean {
	const hint = modal.querySelector<HTMLInputElement>("input[placeholder]")?.placeholder ?? "";
	if (!hint.startsWith(TITLE_PREFIX)) return false;
	const path = hint.slice(TITLE_PREFIX.length).trim();
	if (!batch.names.has(basename(path))) return false;
	return choices(modal).some((item) => item.textContent?.trim() === USE_CHOICE);
}

export function attachImportConflictBatch(doc: Document): () => void {
	const win = doc.defaultView ?? window;
	const handled = new WeakSet<HTMLElement>();

	const onDrop = (event: DragEvent) => {
		const files = Array.from(event.dataTransfer?.files ?? []);
		// A new drop ends the previous choice, including when it has no files.
		activeBatch = files.length > 0 && files.some((file) => !/\.pur$/i.test(file.name))
			? { names: new Set(files.map((file) => file.name)), useExistingForAll: false }
			: null;
	};

	const scan = () => {
		const batch = activeBatch;
		if (!batch) return;
		for (const modal of Array.from(doc.querySelectorAll<HTMLElement>(".prompt"))) {
			if (handled.has(modal) || !isConflictPrompt(modal, batch)) continue;
			const use = choices(modal).find((item) => item.textContent?.trim() === USE_CHOICE);
			if (!use) continue;
			if (batch.useExistingForAll) {
				handled.add(modal);
				use.click();
				continue;
			}
			if (modal.querySelector(".epr-import-conflict-all")) continue;
			const wrapper = doc.win.createDiv();
			wrapper.className = "epr-import-conflict-all";
			const button = doc.win.createEl("button");
			button.type = "button";
			button.textContent = "Use existing for all files in this drop";
			button.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				const current = activeBatch;
				if (!current || !isConflictPrompt(modal, current)) return;
				current.useExistingForAll = true;
				handled.add(modal);
				use.click();
				// Other prompts can be open already, including in another document.
				win.queueMicrotask(() => { for (const rescan of scanners) rescan(); });
			});
			wrapper.appendChild(button);
			modal.appendChild(wrapper);
		}
	};

	const observer = new win.MutationObserver((mutations) => {
		if (!activeBatch) return;
		if (mutations.some((mutation) => {
			const target = mutation.target as Element;
			if (target.closest?.(".prompt")) return true;
			return Array.from(mutation.addedNodes).some((node) =>
				node.instanceOf(win.Element) &&(node.matches(".prompt") || !!node.querySelector(".prompt")),
			);
		})) scan();
	});
	observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["placeholder"] });
	doc.addEventListener("drop", onDrop, true);
	scanners.add(scan);
	scan();
	return () => {
		observer.disconnect();
		doc.removeEventListener("drop", onDrop, true);
		scanners.delete(scan);
	};
}
