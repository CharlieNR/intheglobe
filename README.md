# IntheGlobe

A browser-native procedural deep-time Earth visualisation.

## Current architecture

- `index.html` — application shell and controls.
- `src/main.js` — Three.js scene, camera, controls, shader loading and UI wiring.
- `src/geology_math.js` — quaternion Euler-pole math, spherical-site generation, nearest-site lookup and Catmull-Rom interpolation.
- `src/time_controller.js` — geological year domain, nonlinear recent-time slider and frame-rate-independent playback.
- `src/shaders/globe.vert` — procedural fBM terrain displacement.
- `src/shaders/globe.frag` — procedural biome, ocean/land and population overlay.
- `src/shaders/heatmap.frag` — standalone population overlay shader for a future separate-pass implementation.
- `src/styles.css` — responsive glass-style control HUD.

## Running

The site is static. Serve the repository through GitHub Pages or another static host; ES modules and shader files are loaded relative to the site root.

## Important scientific limitation

This repository is an engineering/procedural foundation, not a scientifically validated paleogeographic reconstruction. A genuine 600 Ma reconstruction requires published plate polygons, calibrated Euler poles, reference frames, uncertainty handling and time-dependent geological datasets. The procedural Voronoi sites and craton keyframes here are deterministic scaffolding and must not be presented as measured reconstruction data.

The architecture intentionally keeps that replacement point isolated: published reconstruction data can replace the procedural site/keyframe layer without changing the renderer or time controller.

## Time mapping

The slider uses a piecewise mapping. The final 15% of its physical width is reserved for the interval from 2 Ma ago through 250 Ma future, with a power curve inside that interval. This prevents the ~300 ka human interval from collapsing into an imperceptible portion of the full 850 Ma range.

Playback is defined as 1,000,000 geological years per real-world second at 1x. Frame advancement is `deltaSeconds × 1,000,000 × speed`, making it independent of display refresh rate.

## No external map tiles

The globe uses procedural geometry and GLSL. It does not fetch raster Earth/map tiles or call an image-generation API.
