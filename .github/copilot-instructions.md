# Repository Guidance for AI Coding Agents

This file records the verified architectural constraints and regression lessons behind Image Compare. Read it before changing image preparation, rendering, viewport controls, diff processing, or browser verification. The user-facing overview and setup instructions live in [`README.md`](../README.md).

## Product purpose

Image Compare is not merely an image viewer that happens to show two pictures. Its key use case is inspecting detail in an AI-upscaled or otherwise higher-resolution image against its lower-resolution source. A visually aligned preview is not useful if the alignment step destroys the detail under inspection.

## Non-negotiable image invariants

1. **Keep both native raster buffers intact for display.** `prepareScene()` is bookkeeping, not a normalization/resampling stage. Do not resize B to A (or A to B) just to simplify drawing.
2. **Map both images to one shared reference box at draw time.** A defines the reference dimensions and zoom presets. Each source gets its own native-pixel-to-reference scale; both cover the same reference origin, while their true detail density remains different. Follow `src/core/modes.ts:drawLayer` and its `fit` / `effective` scale calculations.
3. **Do not force different aspect ratios into identical stretched content.** Preserve each bitmap's aspect ratio in its destination rectangle. Equal-origin images of different aspect ratios can legitimately show different edges; there is no automatic crop or content registration.
4. **Keep display resampling and analytical resampling separate.** Display mips are cached, disposable render optimizations used when zoomed out. They must never replace the native buffers used for inspection at or above native density.
5. **Pixel diff is the deliberate exception that needs a common pixel grid.** The worker projects the coarser input onto the grid with the larger total pixel area so the diff map does not discard real pixels from either source. Resampling artifacts can still affect the analytical comparison: explain this rather than describing diff as perceptual similarity.
6. **Describe coordinates and offsets precisely.** The transform is in reference-box space; B's calibration offsets are reference-space displacements and must continue to mean the same visual distance across native resolutions.

### Why the original resampling design was replaced

The first implementation followed an explicit early product choice: resample B into A's dimensions so all modes could compare one pixel grid. It made overlay alignment simple, but sacrificed the app's main upscale-inspection use case. A browser probe compared a 500 x 500 source with a 2000 x 2000 upscale containing a 2 px checker pattern. Resampling that upscale down to the source grid reduced the pattern to flat grey before it could be inspected. Native buffers and a shared reference-space render mapping replaced that design. Only the diff analysis still resamples, and only onto the finer-area grid.

Treat this history as a product correction, not an optional implementation detail: bringing back unconditional pair normalization recreates a known user-visible data-loss bug.

## Rendering and state architecture

- **One canvas and one shared transform.** All six modes draw/clip into regions on the same canvas. Side-by-side synchronization is structural: both panes use the same scene transform, not two mutable transforms that must be synchronized.
- **Convert pointer anchors into transform space.** In side-by-side mode each pane applies a pane-origin shift. A cursor point in the right pane is not directly the shared transform's anchor. Use `anchorInTransformSpace()` for wheel, pinch, and double-click zoom. A pan/sync-only test is insufficient: both panes can be wrong in the same way while appearing synchronized.
- **React state owns controls; the mutable `Scene` owns render-loop state.** Pointer handlers update the scene and request a canvas frame; do not add a React render for every pointer move. Keep state mirrored through the store's existing patch/render path.
- **Cache expensive work and release owned bitmaps deliberately.** Channel layers and display mips are cached. `ImageBitmap.close()` frees native resources; before closing a bitmap, first clear every scene/UI reference that could still be drawn. `DiffEngine.onResult(null)` is the invalidation path for a dropped diff result. A stale reference fails later inside `drawImage()` as `The image source is detached`.
- **Keep diff off the main thread.** Upload pixels once for each image pair, transfer the buffers, and coalesce settings updates to one in-flight request plus the latest pending request. Do not rebuild a queue of obsolete slider states.
- **Preserve cancellation checks around async image work.** A pair can change while a projected bitmap or channel layer is being built. Verify the scene identity before publishing; close temporary bitmaps abandoned by stale work.
- **Use browser-safe image decode paths.** SVG blobs are not reliably accepted by `createImageBitmap(blob)` across engines. Decode through `HTMLImageElement`, then rasterize vectors deliberately. Sizeless SVGs use the `viewBox` aspect ratio with a fixed 1600 px raster width; they are no longer vector-sharp after import.
- **Keep export and display rendering consistent.** `exportView()` reuses `paintScene()` so canvas modes and overlays match. It exports the canvas viewport, not the DOM toolbar or floating panels. `exportDiff()` is based on the actual diff bitmap grid.

## Performance lessons

- Avoid high-quality downscaling of a full-resolution photo on every animation frame. A measured 4000 x 3000 downscale cost about **24 ms for one draw** (~0.02 ms per frame is the target budget for both cached draws); split mode can draw twice. The 16.7 ms frame budget is already exceeded by a single such draw. Build and reuse a mip chain while zoomed out.
- Use the mip closest to, but not smaller than, the target display size. An undersized mip gets enlarged and needlessly blurs the image.
- Compute mip selection using **effective native render scale** (`transform scale x source-to-reference fit`). Using only the reference transform picks the wrong mip when the source dimensions differ.
- Above native density, preserve a direct path to the original bitmap; mips are for zooming out, not for replacing the pixels users zoom in to inspect.
- Do not infer app jank from an unverified probe. Confirm that all intended test inputs were actually loaded, measure app paint separately from idle `requestAnimationFrame` cadence, and report median/p95/worst with the image dimensions and mode.
- Diff worker buffers can be large: memory scales with the finer pixel grid. Treat memory as a real trade-off; avoid accidental duplicate RGBA copies and release transferred/temporary data when ownership ends.

## Verification lessons: test the actual behavior

Historical probes found that a green test result can still be false evidence. Before trusting a result:

- Assert the **active mode, both loaded filenames/dimensions, and relevant settings** before measuring canvas pixels. A test once reported synchronized panes while it had silently remained in Difference mode after a slider retained focus.
- Use named/scoped file inputs. Generic `input[type=file]` selection hit hidden slot controls instead of the intended upload target and made mismatched-size, export, and performance checks invalid.
- Convert browser coordinates through each element's `getBoundingClientRect()`. Subtract toolbar offsets before sampling canvas pixels; do not mix page, viewport, canvas-CSS, device-pixel, and image coordinates.
- Scale expected pixels for SVG rasterization. A 1600 px raster generated from an 800-unit `viewBox` has a 2:1 raster/user-unit ratio; a visually correct measured offset can therefore be twice the vector coordinate value.
- Account for clipping when measuring image feature centroids; reject clipped candidates rather than interpreting a shifted centroid as zoom drift.
- Prefer distinct, known-color features. A planted change crossing a split can average two colors and make a centroid probe meaningless.
- Check the result **visually** as well as numerically. Passing assertions proved that pixels were painted, but screenshot review still found labels obscured under floating panels, an unreadable saturated heatmap, and a misleading spyglass label.
- A privacy test should distinguish app-owned same-origin assets and a lazily loaded worker from external requests and user-file uploads. The dev server itself generates requests. Check production behavior and assert no cross-origin or request-body upload instead of failing on expected same-origin code.
- Verify that production checks are using a fresh build/preview server; a stale preview can make fixed code appear broken.
- Strengthen a fragile regression probe with mutation testing when possible: deliberately disable the fix and confirm the test fails. A test that passes in both the fixed and broken states does not protect the behavior.
- Make assertions non-vacuous and independent of the action that establishes their preconditions. A predicate like `value >= 0` cannot prove an effect; compare before/after state and assert the mode changed.

## Known user-visible behavior and limits

- The baseline zoom scale of 100% means A at 1:1, not necessarily B at 1:1.
- The shared reference mapping aligns origin/relative viewport geometry; it does not detect corresponding features or automatically register images. Different aspect ratios remain different rather than being force-stretched.
- Diff uses the finer-area raster grid, RGBA channel deltas, and a threshold. It is not SSIM, a perceptual metric, or an AI-upscale quality score.
- The diff's finer grid and native channel/mip copies can consume substantial memory. Large-image or canvas failures are browser/device resource limits, not evidence that source dimensions may be silently degraded.
- Comparison images are local; the built-in samples are fetched from the application origin. Do not claim the app makes no requests of any kind.

## Change checklist

For changes to preparation, draw mapping, zoom, mip selection, worker ownership, or exports:

1. Read the relevant comments and invariants in `src/core/prepare.ts`, `src/core/modes.ts`, `src/core/mip.ts`, `src/core/diff/diffClient.ts`, `src/core/renderer.ts`, and `src/core/exportImage.ts` before changing them.
2. Run `npm run typecheck` and `npm run build`.
3. Verify same-size and mixed-resolution inputs (including the smaller image being B), matching and different aspect ratios, A/B swap, and the affected modes.
4. For zoom work, test wheel/pinch/double-click anchors in both side-by-side panes, not only sync or pan.
5. For async bitmap work, replace/swap/clear the pair during diff or layer preparation and check for detached bitmap errors.
6. For visual work, inspect rendered screenshots at display size and at high zoom; numerical probes alone cannot reveal labels hidden behind UI or a meaningless color ramp.
7. For performance work, use at least two explicitly verified large input images and report the measurement conditions.
8. Never stage `.cc-history/` or other local conversation records. They are debugging evidence for maintainers, not product documentation.
