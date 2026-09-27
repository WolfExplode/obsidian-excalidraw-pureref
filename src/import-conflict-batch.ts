/**
 * Applies Excalidraw's "Use" collision choice to the other files in one drop.
 * The community plugin creates a separate GenericSuggester for each file, so
 * this observes only that exact prompt and clicks its existing choice. It does
 * not replace the import pipeline or change how the attachment is resolved.
 */

const TITLE_PREFIX = "A file with the same name/path already exists in the Vault";
const USE_CHOICE = "Use the file already in the Vault instead of importing";
const OVERWRITE_CHOICE = "Overwrite existing file in the Vault";
const IMPORT_CHOICE = "Import the file with a new name";

interface DropBatch {
	names: Set<string>;
	useExistingForAll: boolean;
}

// Obsidian may render a Popout's suggester in the main document. Both document
// listeners therefore share the current drop while retaining their own DOM hooks.
let activeBatch: DropBatch | null = null;

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
	const labels = choices(modal).map((item) => item.textContent?.trim());
	return labels.includes(USE_CHOICE) && labels.includes(OVERWRITE_CHOICE) && labels.includes(IMPORT_CHOICE);
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
		for (const modal of Array.from(doc.querySelectorAll<HTMLElement>(".modal"))) {
			if (handled.has(modal) || !isConflictPrompt(modal, batch)) continue;
			const use = choices(modal).find((item) => item.textContent?.trim() === USE_CHOICE);
			if (!use) continue;
			if (batch.useExistingForAll) {
				handled.add(modal);
				use.click();
				continue;
			}
			if (modal.querySelector(".epr-import-conflict-hint")) continue;
			const hint = doc.createElement("div");
			hint.className = "epr-import-conflict-hint";
			hint.textContent = "Ctrl-click ‘Use the file already in the Vault’ to apply it to all files in this drop.";
			hint.style.cssText = "padding: 8px 14px; color: var(--text-muted); font-size: var(--font-ui-smaller);";
			modal.appendChild(hint);
		}
	};

	const onClick = (event: MouseEvent) => {
		if (!event.ctrlKey && !event.metaKey) return;
		const item = event.target instanceof win.Element
			? event.target.closest<HTMLElement>(".suggestion-item") : null;
		const modal = item?.closest<HTMLElement>(".modal");
		const batch = activeBatch;
		if (!batch || !item || !modal || item.textContent?.trim() !== USE_CHOICE || !isConflictPrompt(modal, batch)) return;
		batch.useExistingForAll = true;
		handled.add(modal);
		// Let the community plugin handle this click before selecting other open
		// prompts. Later prompts are selected by the mutation observer.
		win.queueMicrotask(scan);
	};

	const observer = new win.MutationObserver((mutations) => {
		if (!activeBatch) return;
		if (mutations.some((mutation) => {
			const target = mutation.target as Element;
			if (target.closest?.(".modal")) return true;
			return Array.from(mutation.addedNodes).some((node) =>
				node instanceof win.Element && (node.matches(".modal") || !!node.querySelector(".modal")),
			);
		})) scan();
	});
	observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["placeholder"] });
	doc.addEventListener("drop", onDrop, true);
	doc.addEventListener("click", onClick, true);
	scan();
	return () => {
		observer.disconnect();
		doc.removeEventListener("drop", onDrop, true);
		doc.removeEventListener("click", onClick, true);
	};
}
