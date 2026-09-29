/*
 * Obsidian installs its DOM helpers (`createEl`, `createDiv`, ...) as globals
 * in every window, Popouts included, but obsidian.d.ts only types them on the
 * main window's global scope. Declaring them on `Window` lets code create a
 * detached element owned by a specific window's document via `win.createEl`,
 * the same as `win.document.createElement`. Verified live in a Popout
 * (Obsidian 1.9.12): the element's ownerDocument is the Popout's document.
 */
interface Window {
	createEl: typeof createEl;
	createDiv: typeof createDiv;
}
