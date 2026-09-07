# IntheGlobe

IntheGlobe is a browser-based deep-time Earth visualiser built around Three.js and published GPlates reconstruction data.

## Reconstruction data

The application uses the GPlates Web Service with the Müller et al. 2022 global model (`MULLER2022`). The service exposes reconstructed static polygons, coastlines, point reconstruction and Euler-pole rotation information. The model lineage and time coverage are documented by EarthByte/GPlates.

Historical view: the app requests the published reconstruction at the selected geological age, rather than inventing continent positions.

Future view: after the present, the app starts from the present-day reconstructed geometry and applies each plate's present-day Euler rotation continuously at a constant angular rate. This is an explicit extrapolation, not a claim that the real future Earth is known.

## Controls

- Geological slider: 600 Ma ago → 250 Ma future.
- Slider commits on release (`change`) rather than every drag event.
- Play/pause with frame-rate-independent geological time.
- 1×, 2×, 5×, 10× and 100× playback.
- Country tracker: select a country to highlight it and have the camera follow it during playback.
- Free camera: clears country tracking.
- Control-panel minimise button: hides the HUD while keeping the globe interactive.

## Scientific scope

The reconstruction is intended to show published plate-model geometry as faithfully as the chosen model and browser representation permit. Paleogeographic reconstructions still have uncertainties, especially farther back in time, and different published models can produce different positions and plate histories.

The project deliberately keeps the rendering layer separate from the data layer so another published GPlates model can be selected later without rewriting the Three.js scene.

## Files

- `index.html` — application shell and controls.
- `src/main.js` — renderer, reconstruction loading, country tracking and UI.
- `src/gplates_client.js` — GPlates Web Service client.
- `src/time_controller.js` — time scaling and animation.
- `src/country_tracker.js` — country definitions for the tracker.
- `src/geology_math.js` — quaternion and spherical geometry utilities.
- `src/shaders/` — procedural rendering shaders retained for terrain/heatmap effects.
