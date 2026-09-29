# Excalidraw PureRef

Excalidraw PureRef is a desktop-only Obsidian plugin for using an
[Excalidraw](https://github.com/zsviczian/obsidian-excalidraw-plugin) Board as
a PureRef-style reference surface. Visit the [original app's website](https://www.pureref.com/) to find out the eventual intended feature set of this plugin. 

Turns an Excalidraw Board into a always-on-top reference Popout. 
See the complete [interaction reference](docs/behavior/user-interaction-overrides.md).

## Features

### **Popout window** 
- Pop the active Board out into a chrome-free,
  always-on-top OS window (**F11**) that can be dragged with a right-button
  drag, and toggled between a fully editable mode and a separate transparent,
  click-through reference mode (**F10**).

- **Opacity control** **Ctrl+−/+** adjusts selected-element opacity, or the
  whole Popout window's opacity when nothing is selected.
  
https://github.com/user-attachments/assets/b30dba76-fb94-49ec-b3e8-ca915fdcafd4

### **Image crop, flip, and transform**
  - Hold **C** and drag to crop selected images to a rectangle.
  - **Alt+Shift-drag** to flip selected images horizontally or vertically.
  - **Ctrl-drag** a rectangle to remove elements from the current selection.
  - **Alt+double-click** to remove a crop. Double-click a custom-cropped image
    to open Excalidraw's native crop editor.
  - Blender-style **G** / **R** / **S** move, rotate, and scale. 
  - **Alt+R** to reset rotation; **Alt+S** to set image scale to 25% of native size.

https://github.com/user-attachments/assets/fda37d9a-c42b-4f69-adbe-68710d3f4a9d

### **Arrangement and packing**
  - **Ctrl+Arrow** packs selected references toward an edge. **Ctrl+Shift+P**
    arranges the selection into a compact layout.
  - **Ctrl+Alt+Arrow** normalizes selected images to matching height, width,
    size, or scale (also in the context menu under **Normalize**).
  - Multi-file media drops are auto-arranged into a compact PureRef-style
    block.
  - Overlap-aware **Bring Forward** / **Send Backward** (**Ctrl+]** /
    **Ctrl+[**) jumps past non-overlapping elements instead of one slot at a
    time.

<img width="800" height="453" alt="Image Manipulation" src="https://github.com/user-attachments/assets/336990ed-c6e8-4e14-bbe2-c9ae7ebd5588" />

### **Media import/export**
  - Multi-file external drops turn imported GIF, WebP, and APNG images into
    playing embeddables. Single-file drops retain Excalidraw's image/embeddable
    choice.
  - Open a Board and run **Import PureRef file into current Board** from
    the Obsidian command palette to choose a `.pur` file. Image attachments
    go to the location configured in Obsidian's attachment settings.
  - Drop a `.pur` file onto a Board to choose between importing its media and
    linking the file as usual.
  - Run **Export Board images and text to PureRef file (1.x)** or **(2.x)** to
    write the current Board to a `.pur` file. Only images, GIFs, and standalone
    text are included. The 1.x export bakes image transforms into PNGs; the
    2.x export preserves original PNG, JPEG, and GIF bytes and their placement.
  - **Ctrl+Shift+E** exports every selected image/video/embed to a folder,
    rendering cropped images to a fresh PNG of just the visible crop.

https://github.com/user-attachments/assets/ef692124-d11f-45e1-9bf0-eae5ea1d6914

### **Find Duplicates** Right-click (or **Ctrl/Cmd+F**) with one element
  selected to find and select every other element on the Board that matches
  it by file, link, or geometry.

https://github.com/user-attachments/assets/f46d778a-d19e-4333-923e-546536047d4a

### **Draw on Embeddables**

- In default Excalidraw, nothing can ever be drawn or placed in front of a video/PDF/markdown/web embed. This plugin fixes that.

https://github.com/user-attachments/assets/6fabca8b-9dae-4148-8c86-74e51e6ee2b9

## Requirements

- Obsidian Desktop v1.13.0 or newer (tested with v1.13.4; older supported versions have not been tested)
- The [Obsidian Excalidraw community plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin).
- I have not tested mac or linux systems so consider this plugin windows only. 

## Install for development
This plugin is still in development so it is not yet available on [community plugins](https://community.obsidian.md/plugins), pending review.

1. Clone this repository into your vault's `.obsidian/plugins/excalidraw-pureref/`
   folder.
2. Run `npm install` in the repository root.
3. Run `npm run build` after every source change.
4. In Obsidian, enable both **Excalidraw** and **Excalidraw PureRef** in
   Community plugins.

## Documentation

The [documentation guide](docs/README.md) routes both users and contributors to the right material.

For contributor workflow and repository-specific guardrails, see [AGENTS.md](AGENTS.md).

### Current status
As the plugin is now, it's fully functional as a reference board, but still lacks some of the features that make pureref, pureref. (The transparent read-only Popout mode was the only way I managed to get some of the transparency features to render properly, if it feels clunky to use... I know.)

PureRef 1.10/1.11 and 2.0/2.1 image placements and notes can be imported from `.pur` files.
Pen strokes, editable group structure, and rich note styling are not imported.
Board images and standalone text can be exported to PureRef 1.10 or 2.x `.pur`
files. Other elements, including drawings, videos, and embeds, are skipped.

### Limitations

I've decided to delegate file format support to a different plugin. See This [plugin fork](https://github.com/WolfExplode/obsidian-extended-file-support/tree/Main-development-branch) for more information

## Contributing

Feel free to open any issues or fork this repo and implement your own changes.
