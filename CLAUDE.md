# SYSTEM PROMPT: Client-Side Dual Image Comparison Web Application
### Project Overview
Build a lightweight, responsive, and purely **client-side** Image Comparison Web Application. The application must process images locally (100% in-browser, no backend/server uploads) and provide a professional suite of image comparison tools with synchronized viewport controls.

### Key Requirements & Features

#### 1. Input & Image Ingestion
- **Upload Methods**: Drag-and-drop zone, file picker, and direct clipboard paste (`Ctrl+V` / `Cmd+V`).
- **Formats**: Support PNG, JPG, WebP, AVIF, SVG.
- **Privacy Assurance**: Clear indicator that all processing is done locally in the browser.
- **Image Metadata**: Display dimensions (WxH), file size, and aspect ratio for both Image A (Before) and Image B (After).

#### 2. Comparison Modes (Core Feature)
Implement a mode switcher toolbar with the following 6 modes:
1. **Split Slider (Juxtaposition)**:
   - Interactive draggable divider line (Vertical & Horizontal toggle).
   - Smooth mouse/touch drag with label overlays ("Before" / "After").
2. **Side-by-Side**:
   - Two viewports placed side-by-side or stacked vertically.
   - **Synchronized Pan & Zoom**: Panning or zooming in one pane immediately reflects in the other.
3. **Fade / Opacity**:
   - Overlaid images with an interactive 0%–100% opacity slider.
4. **Pixel Difference (Diff View)**:
   - Uses Canvas blend mode (`difference`) or a pixel diff algorithm to highlight visual discrepancies.
   - Include a threshold/sensitivity slider.
5. **Flicker / Quick Toggle**:
   - Rapid toggle between A and B via spacebar/click.
   - Auto-flicker toggle with adjustable speed (FPS / interval slider).
6. **Spyglass (Magnifier Lens)**:
   - Floating circular lens following the cursor displaying the alternate image at current or higher zoom.

#### 3. Viewport & Inspection Controls
- **Synchronized Zoom & Pan**:
  - Mouse wheel zoom (centered at cursor), pinch-to-zoom on touch screens.
  - Drag to pan across all viewports.
  - Zoom presets: `Fit to Screen`, `100% (1:1)`, `200%`, `400%`.
- **Image Alignment & Calibration**:
  - Offset controls (X/Y shift) for manual alignment if input images are slightly misaligned.
  - Swap Image A and B button.
- **Color & Channel Inspection (Optional/Bonus)**:
  - Isolate RGB channels (Red, Green, Blue, Grayscale).

#### 4. UI/UX & Design
- **Theme**: Dark mode optimized for visual work (neutral dark gray canvas `#121212` to avoid color perception bias).
- **Layout**: Maximized canvas workspace with floating/collapsible toolbars.
- **Keyboard Shortcuts**:
  - `Space`: Toggle between images / Hold to switch.
  - `1 - 6`: Quick-switch comparison modes.
  - `0`: Reset Zoom & Pan.
  - `F`: Fullscreen mode.
- **Export**: Capture/Export the current comparison view or the Diff map as a PNG file.

#### 5. Technical Stack Recommendation
- **Framework**: React / Vue / Vanilla JavaScript + Tailwind CSS.
- **Rendering**: HTML5 Canvas API or WebGL for high performance on high-resolution images.

### CRITICAL MODULE: Resolution-Independent Sync & AI Upscale Inspection Engine
#### Objective:
Handle comparison between images of **different native resolutions** (e.g., Low-Res original 500x500 vs. AI Upscaled 2000x2000, 4K, 8K) without resampling/modifying physical raw pixel data in memory, while maintaining perfectly aligned visual viewports and synchronized zoom.

#### Detailed Technical Specifications:
1. **Zero-Resampling Architecture (Preserve Native Buffers)**:
   - Do **NOT** physically downscale Image B or upscale Image A to match resolutions in memory.
   - Maintain full, uncompressed native image buffers for both images to ensure zero quality degradation.

2. **Normalized Coordinate Space (UV / Percentage-Based Mapping)**:
   - All spatial transformations (Pan `(X, Y)` and Zoom origin `(Cx, Cy)`) must operate in a **Normalized Relative Space [0.0 to 1.0]** rather than physical pixel offsets.
   - Coordinate conversion formula:
     $$\text{TargetPixel}_A = (\text{Norm}_X \times W_A, \text{Norm}_Y \times H_A)$$
     $$\text{TargetPixel}_B = (\text{Norm}_X \times W_B, \text{Norm}_Y \times H_B)$$
   - This ensures that zooming into a 10% sub-region from top-left centers precisely on the exact same visual content on both images simultaneously without any drift.

3. **Unified Viewport Bounding Box & GPU Scaling**:
   - Force both images to occupy the exact same display bounding box on the screen.
   - Render Scale is dynamically computed:
     - **Image A (Low-Res Original)**: Rendered larger via CSS/GPU (`Render Scale > 100%`), revealing pixelation, noise, or compression artifacts.
     - **Image B (High-Res Upscale)**: Rendered with native high density (`Render Scale < 100%` or 1:1 on zoom), delivering razor-sharp AI enhanced details.

4. **Split Slider & Lens Alignment on Different Resolutions**:
   - Slider divider position (`0% to 100%`) must calculate clipping paths using normalized viewport percentages (`clip-path: inset(...)` or Canvas clipping regions).
   - Spyglass/Magnifier lens must project the exact normalized sub-region from Image B onto the corresponding area of Image A at full optical sharpness.

5. **Rendering Filter Toggle for Baseline Inspection**:
   - Provide a toggle for Image A's display scaling:
     - `Pixelated / Nearest-Neighbor`: Ideal for inspecting exact original pixel grids.
     - `Bilinear / Bicubic`: Standard smoothed display.