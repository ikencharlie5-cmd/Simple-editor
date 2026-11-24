export type ToolId =
  | 'move' | 'artboard'
  | 'marquee-rect' | 'marquee-ellipse' | 'marquee-row' | 'marquee-col'
  | 'lasso' | 'lasso-poly' | 'lasso-magnetic' | 'selection-brush'
  | 'object-select' | 'quick-select' | 'magic-wand'
  | 'crop' | 'crop-perspective' | 'slice' | 'slice-select'
  | 'frame'
  | 'eyedropper' | 'eyedropper-3d' | 'color-sampler' | 'ruler' | 'note' | 'count'
  | 'remove' | 'spot-heal' | 'heal' | 'patch' | 'content-move' | 'red-eye'
  | 'brush' | 'pencil' | 'color-replace' | 'mixer-brush' | 'adjust-brush'
  | 'clone-stamp' | 'pattern-stamp'
  | 'history-brush' | 'art-history'
  | 'eraser' | 'bg-eraser' | 'magic-eraser'
  | 'gradient' | 'bucket'
  | 'blur' | 'sharpen' | 'smudge'
  | 'dodge' | 'burn' | 'sponge'
  | 'pen' | 'pen-free' | 'pen-curvature' | 'anchor-add' | 'anchor-delete' | 'anchor-convert'
  | 'type-h' | 'type-v' | 'type-mask-h' | 'type-mask-v'
  | 'path-select' | 'direct-select'
  | 'shape-rect' | 'shape-ellipse' | 'shape-triangle' | 'shape-polygon' | 'shape-line' | 'shape-custom'
  | 'hand' | 'rotate-view' | 'zoom'

export interface ToolDef { id: ToolId; name: string; icon: string; hint: string }
export interface ToolGroup { key: string; tools: ToolDef[]; section: string }

export const TOOL_GROUPS: ToolGroup[] = [
  { key: 'V', section: 'Move & Selection', tools: [
    { id: 'move', name: 'Move Tool', icon: '✥', hint: 'Drag to move the active layer, or the selected pixels if there is a selection. Arrow keys nudge.' },
    { id: 'artboard', name: 'Artboard Tool', icon: '⬚', hint: 'Drag to set a new artboard (canvas) area. Extends with white, keeps all layers.' },
  ] },
  { key: 'M', section: 'Move & Selection', tools: [
    { id: 'marquee-rect', name: 'Rectangular Marquee Tool', icon: '⬜', hint: 'Drag to select. Shift = square / add, Alt = subtract, Shift+Alt = intersect.' },
    { id: 'marquee-ellipse', name: 'Elliptical Marquee Tool', icon: '⬭', hint: 'Drag to select an ellipse. Shift = circle / add, Alt = subtract.' },
    { id: 'marquee-row', name: 'Single Row Marquee Tool', icon: '═', hint: 'Click to select a 1-pixel row.' },
    { id: 'marquee-col', name: 'Single Column Marquee Tool', icon: '║', hint: 'Click to select a 1-pixel column.' },
  ] },
  { key: 'L', section: 'Move & Selection', tools: [
    { id: 'lasso', name: 'Lasso Tool', icon: '➰', hint: 'Drag a freehand selection.' },
    { id: 'lasso-poly', name: 'Polygonal Lasso Tool', icon: '⬠', hint: 'Click points; double-click or click the first point to close. Esc cancels.' },
    { id: 'lasso-magnetic', name: 'Magnetic Lasso Tool', icon: '🧲', hint: 'Click once, then move along an edge; the path snaps to edges. Double-click to close.' },
    { id: 'selection-brush', name: 'Selection Brush Tool', icon: '🖌', hint: 'Paint to add to the selection. Alt = paint to subtract.' },
  ] },
  { key: 'W', section: 'Move & Selection', tools: [
    { id: 'object-select', name: 'Object Selection Tool', icon: '🎯', hint: 'Drag a box around an object; it finds the object inside.' },
    { id: 'quick-select', name: 'Quick Selection Tool', icon: '🪄', hint: 'Paint over an area; the selection grows to similar connected colours. Alt subtracts.' },
    { id: 'magic-wand', name: 'Magic Wand Tool', icon: '✨', hint: 'Click to select similar colours (tolerance / contiguous in the options bar).' },
  ] },
  { key: 'C', section: 'Crop & Slice', tools: [
    { id: 'crop', name: 'Crop Tool', icon: '⌗', hint: 'Drag a crop box, then press Enter (or ✓) to crop. Esc cancels. Can extend beyond the canvas.' },
    { id: 'crop-perspective', name: 'Perspective Crop Tool', icon: '⏢', hint: 'Click 4 corners of a skewed area (TL, TR, BR, BL), then Enter to straighten it.' },
    { id: 'slice', name: 'Slice Tool', icon: '🔪', hint: 'Drag to create slices; export them as separate images from the Export tab.' },
    { id: 'slice-select', name: 'Slice Select Tool', icon: '⬚', hint: 'Click a slice to select it, drag to move, Delete to remove.' },
  ] },
  { key: 'K', section: 'Crop & Slice', tools: [
    { id: 'frame', name: 'Frame Tool', icon: '🖼', hint: 'Drag to create an image frame (rect or ellipse), then click "Place image" or drop a file onto it.' },
  ] },
  { key: 'I', section: 'Measurement & Eyedropper', tools: [
    { id: 'eyedropper', name: 'Eyedropper Tool', icon: '💧', hint: 'Click to pick the foreground colour. Alt+click picks background.' },
    { id: 'eyedropper-3d', name: '3D Material Eyedropper Tool', icon: '🧊', hint: 'Samples the averaged surface (material) colour of an 11×11 area into the foreground.' },
    { id: 'color-sampler', name: 'Color Sampler Tool', icon: '⊕', hint: 'Click to place up to 10 colour samplers; values appear in the Info panel. Alt+click removes.' },
    { id: 'ruler', name: 'Ruler Tool', icon: '📏', hint: 'Drag to measure distance and angle. "Straighten layer" rotates to level the line.' },
    { id: 'note', name: 'Note Tool', icon: '🗒', hint: 'Click to add a note. Click a note to edit it.' },
    { id: 'count', name: 'Count Tool', icon: '#', hint: 'Click to add numbered count markers. Alt+click removes the nearest.' },
  ] },
  { key: 'J', section: 'Retouching & Painting', tools: [
    { id: 'remove', name: 'Remove Tool', icon: '🩹', hint: 'Paint over an object to remove it; the area is filled from its surroundings.' },
    { id: 'spot-heal', name: 'Spot Healing Brush Tool', icon: '⊚', hint: 'Paint over spots and blemishes to heal them automatically.' },
    { id: 'heal', name: 'Healing Brush Tool', icon: '✚', hint: 'Alt+click to set a source, then paint. Texture is copied and colour-matched.' },
    { id: 'patch', name: 'Patch Tool', icon: '◫', hint: 'Draw around the area to fix, then drag it onto a clean area to use as the patch source.' },
    { id: 'content-move', name: 'Content-Aware Move Tool', icon: '⤧', hint: 'Draw around an object, then drag it somewhere else; the hole is filled automatically.' },
    { id: 'red-eye', name: 'Red Eye Tool', icon: '👁', hint: 'Click on a red pupil to fix it.' },
  ] },
  { key: 'B', section: 'Retouching & Painting', tools: [
    { id: 'brush', name: 'Brush Tool', icon: '🖌', hint: 'Paint with the foreground colour. [ and ] change size. Shift+click draws straight lines.' },
    { id: 'pencil', name: 'Pencil Tool', icon: '✏️', hint: 'Hard-edged, aliased painting.' },
    { id: 'color-replace', name: 'Color Replacement Tool', icon: '🎨', hint: 'Paint to replace the colour under the brush centre with the foreground colour, keeping shading.' },
    { id: 'mixer-brush', name: 'Mixer Brush Tool', icon: '🖍', hint: 'Paint that picks up and mixes with the colours on the canvas.' },
    { id: 'adjust-brush', name: 'Adjustment Brush Tool', icon: '☀', hint: 'Paint brightness / saturation / warmth adjustments locally.' },
  ] },
  { key: 'S', section: 'Retouching & Painting', tools: [
    { id: 'clone-stamp', name: 'Clone Stamp Tool', icon: '⎘', hint: 'Alt+click to set a source, then paint to copy pixels from it.' },
    { id: 'pattern-stamp', name: 'Pattern Stamp Tool', icon: '▦', hint: 'Paint with a pattern (choose it in the options bar).' },
  ] },
  { key: 'Y', section: 'Retouching & Painting', tools: [
    { id: 'history-brush', name: 'History Brush Tool', icon: '↺', hint: 'Paints back pixels from the history state marked as source (click ◉ in the History panel).' },
    { id: 'art-history', name: 'Art History Brush Tool', icon: '🖼', hint: 'Paints stylised strokes using the history source.' },
  ] },
  { key: 'E', section: 'Retouching & Painting', tools: [
    { id: 'eraser', name: 'Eraser Tool', icon: '⌫', hint: 'Erase to transparency.' },
    { id: 'bg-eraser', name: 'Background Eraser Tool', icon: '⊘', hint: 'Erases colours similar to the one under the brush centre.' },
    { id: 'magic-eraser', name: 'Magic Eraser Tool', icon: '✨', hint: 'Click to erase all similar connected colour.' },
  ] },
  { key: 'G', section: 'Retouching & Painting', tools: [
    { id: 'gradient', name: 'Gradient Tool', icon: '▤', hint: 'Drag to draw a gradient from foreground to background colour.' },
    { id: 'bucket', name: 'Paint Bucket Tool', icon: '🪣', hint: 'Click to fill similar connected colour with the foreground colour.' },
  ] },
  { key: '', section: 'Retouching & Painting', tools: [
    { id: 'blur', name: 'Blur Tool', icon: '💧', hint: 'Paint to soften.' },
    { id: 'sharpen', name: 'Sharpen Tool', icon: '△', hint: 'Paint to sharpen.' },
    { id: 'smudge', name: 'Smudge Tool', icon: '👆', hint: 'Drag to smear pixels.' },
  ] },
  { key: 'O', section: 'Retouching & Painting', tools: [
    { id: 'dodge', name: 'Dodge Tool', icon: '◐', hint: 'Paint to lighten.' },
    { id: 'burn', name: 'Burn Tool', icon: '◑', hint: 'Paint to darken.' },
    { id: 'sponge', name: 'Sponge Tool', icon: '🧽', hint: 'Paint to saturate or desaturate.' },
  ] },
  { key: 'P', section: 'Drawing & Type', tools: [
    { id: 'pen', name: 'Pen Tool', icon: '✒', hint: 'Click for corners, drag for curves. Click the first point to close. Enter/Esc finishes.' },
    { id: 'pen-free', name: 'Freeform Pen Tool', icon: '〰', hint: 'Drag to draw a path freehand.' },
    { id: 'pen-curvature', name: 'Curvature Pen Tool', icon: '∿', hint: 'Click points; curves are computed automatically. Enter/Esc finishes.' },
    { id: 'anchor-add', name: 'Add Anchor Point Tool', icon: '+', hint: 'Click on a path segment to add an anchor.' },
    { id: 'anchor-delete', name: 'Delete Anchor Point Tool', icon: '−', hint: 'Click an anchor to delete it.' },
    { id: 'anchor-convert', name: 'Convert Point Tool', icon: '^', hint: 'Click an anchor to toggle corner/smooth; drag from it to pull out handles.' },
  ] },
  { key: 'T', section: 'Drawing & Type', tools: [
    { id: 'type-h', name: 'Horizontal Type Tool', icon: 'T', hint: 'Click to type. Ctrl+Enter or click outside to commit, Esc cancels.' },
    { id: 'type-v', name: 'Vertical Type Tool', icon: 'Ⓣ', hint: 'Click to type vertically.' },
    { id: 'type-mask-h', name: 'Horizontal Type Mask Tool', icon: '🅃', hint: 'Type to create a selection in the shape of text.' },
    { id: 'type-mask-v', name: 'Vertical Type Mask Tool', icon: '⊤', hint: 'Type vertical text as a selection.' },
  ] },
  { key: 'A', section: 'Drawing & Type', tools: [
    { id: 'path-select', name: 'Path Selection Tool', icon: '➤', hint: 'Click a path to select it, drag to move it.' },
    { id: 'direct-select', name: 'Direct Selection Tool', icon: '⇱', hint: 'Drag anchors and handles of the active path.' },
  ] },
  { key: 'U', section: 'Drawing & Type', tools: [
    { id: 'shape-rect', name: 'Rectangle Tool', icon: '▭', hint: 'Drag to draw. Shift = square. Uses fill/stroke from the options bar.' },
    { id: 'shape-ellipse', name: 'Ellipse Tool', icon: '◯', hint: 'Drag to draw. Shift = circle.' },
    { id: 'shape-triangle', name: 'Triangle Tool', icon: '△', hint: 'Drag to draw a triangle.' },
    { id: 'shape-polygon', name: 'Polygon Tool', icon: '⬡', hint: 'Drag to draw a polygon (sides in the options bar).' },
    { id: 'shape-line', name: 'Line Tool', icon: '╱', hint: 'Drag to draw a line. Shift snaps to 45°.' },
    { id: 'shape-custom', name: 'Custom Shape Tool', icon: '★', hint: 'Drag to draw the chosen custom shape.' },
  ] },
  { key: 'H', section: 'Navigation', tools: [{ id: 'hand', name: 'Hand Tool', icon: '✋', hint: 'Drag to pan. Hold Space with any tool to pan temporarily.' }] },
  { key: 'R', section: 'Navigation', tools: [{ id: 'rotate-view', name: 'Rotate View Tool', icon: '⟳', hint: 'Drag to rotate the view (not the image). Double-click the tool or press Esc to reset.' }] },
  { key: 'Z', section: 'Navigation', tools: [{ id: 'zoom', name: 'Zoom Tool', icon: '🔍', hint: 'Click to zoom in, Alt+click to zoom out. Ctrl+0 fit, Ctrl+1 100%.' }] },
]

export const ALL_TOOLS = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => ({ ...t, key: g.key })))
export const toolDef = (id: ToolId) => ALL_TOOLS.find((t) => t.id === id)!
export const groupOf = (id: ToolId) => TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === id))!

export interface ToolOptions {
  size: number
  hardness: number
  opacity: number
  flow: number
  tolerance: number
  contiguous: boolean
  sampleAll: boolean
  feather: number
  selMode: 'new' | 'add' | 'subtract' | 'intersect'
  gradientType: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond'
  gradientTransparent: boolean
  shapeFill: boolean
  shapeStroke: boolean
  strokeWidth: number
  sides: number
  customShape: 'star' | 'heart' | 'arrow' | 'bubble' | 'check' | 'bolt' | 'chicken'
  fontSize: number
  fontFamily: string
  bold: boolean
  italic: boolean
  range: 'shadows' | 'midtones' | 'highlights'
  exposure: number
  spongeMode: 'saturate' | 'desaturate'
  strength: number
  pattern: 'checker' | 'dots' | 'stripes' | 'bricks' | 'noise' | 'grid'
  adjBrightness: number
  adjSaturation: number
  adjWarmth: number
  wet: number
  aligned: boolean
  sampleSize: 1 | 3 | 5
  frameShape: 'rect' | 'ellipse'
  cropDelete: boolean
  tip: 'round' | 'square' | 'flat' | 'chalk' | 'spray'
  spacing: number
  scatter: number
  angle: number
  pressure: boolean
  radius: number
  lineHeight: number
  letterSpacing: number
  align: 'left' | 'center' | 'right'
}

export const DEFAULT_OPTIONS: ToolOptions = {
  size: 30, hardness: 0.7, opacity: 1, flow: 1, tolerance: 32, contiguous: true, sampleAll: false, feather: 0, selMode: 'new',
  gradientType: 'linear', gradientTransparent: false, shapeFill: true, shapeStroke: false, strokeWidth: 4, sides: 6, customShape: 'star',
  fontSize: 72, fontFamily: 'Inter, system-ui, sans-serif', bold: false, italic: false, range: 'midtones', exposure: 0.5,
  spongeMode: 'desaturate', strength: 0.5, pattern: 'checker', adjBrightness: 0.3, adjSaturation: 0, adjWarmth: 0, wet: 0.5, aligned: true,
  sampleSize: 1, frameShape: 'rect', cropDelete: true,
  tip: 'round', spacing: 0.2, scatter: 0, angle: 45, pressure: true, radius: 0, lineHeight: 1.2, letterSpacing: 0, align: 'left',
}

export const BRUSH_TOOLS: ToolId[] = ['brush', 'pencil', 'color-replace', 'mixer-brush', 'adjust-brush', 'clone-stamp', 'pattern-stamp', 'history-brush', 'art-history',
  'eraser', 'bg-eraser', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge', 'remove', 'spot-heal', 'heal', 'selection-brush', 'quick-select']

export interface BrushPreset { name: string; size: number; hardness: number; flow: number; opacity: number; tip: ToolOptions['tip']; spacing: number; scatter: number; angle?: number }
export const BRUSH_PRESETS: BrushPreset[] = [
  { name: 'Soft round', size: 40, hardness: 0, flow: 1, opacity: 1, tip: 'round', spacing: 0.15, scatter: 0 },
  { name: 'Hard round', size: 20, hardness: 0.95, flow: 1, opacity: 1, tip: 'round', spacing: 0.12, scatter: 0 },
  { name: 'Airbrush', size: 80, hardness: 0, flow: 0.08, opacity: 1, tip: 'round', spacing: 0.08, scatter: 0 },
  { name: 'Ink pen', size: 6, hardness: 0.9, flow: 1, opacity: 1, tip: 'round', spacing: 0.08, scatter: 0 },
  { name: 'Marker', size: 24, hardness: 0.85, flow: 1, opacity: 0.7, tip: 'square', spacing: 0.1, scatter: 0 },
  { name: 'Calligraphy', size: 30, hardness: 0.9, flow: 1, opacity: 1, tip: 'flat', spacing: 0.05, scatter: 0, angle: 45 },
  { name: 'Chalk', size: 36, hardness: 0.7, flow: 0.8, opacity: 1, tip: 'chalk', spacing: 0.2, scatter: 0.1 },
  { name: 'Spray paint', size: 70, hardness: 0.3, flow: 1, opacity: 1, tip: 'spray', spacing: 0.15, scatter: 0 },
  { name: 'Pencil sketch', size: 4, hardness: 0.6, flow: 0.6, opacity: 0.8, tip: 'chalk', spacing: 0.1, scatter: 0 },
  { name: 'Leaves scatter', size: 26, hardness: 0.8, flow: 1, opacity: 1, tip: 'round', spacing: 0.9, scatter: 1.2 },
]
