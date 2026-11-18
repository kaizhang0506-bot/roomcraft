# Reference and license audit

Checked 2026-11-17. All five requested READMEs were read before reference-driven implementation.

| Reference | Branch / license | Role |
| --- | --- | --- |
| https://github.com/ZWD11/house-plan-designer | main / MIT | End-to-end feature benchmark; do not inherit its full Python dependency list |
| https://github.com/wy51ai/floorplan-3d | master / MIT | Interaction skeleton: SVG plan, shared semantic scene, Three.js views, WASD and room navigation |
| https://github.com/ashnomad/Blueprint3D | main / no LICENSE found | README architecture reference only; no source, models, weights or assets copied |
| https://github.com/Yytsi/floorplan-to-3d | main / MIT code | Segmentation-to-contours and FastAPI service architecture reference; no pretrained weights copied |
| https://github.com/pascalorg/editor | main / MIT | Editable semantic nodes; existing separate advanced editor integration |

The primary editor implementation is original Roomcraft code following the SVG/Three.js interaction structure. No code from the unlicensed reference is used. Third-party MIT package copyright and licenses remain applicable.

## Exclusions

- PyMuPDF is AGPL/commercial and is excluded. Browser PDF preprocessing continues to use Apache-2.0 PDF.js.
- CubiCasa5K is CC BY-NC4.0. Yytsi code MIT does not establish commercial permission for its trained weights; those weights and data are excluded.
- CPU recognition is authored here with FastAPI, Pillow and NumPy, without downloaded recognition weights. It is a geometric prototype for clean orthogonal plans and marked demo openings, not a claim of general semantic segmentation accuracy.
- No GPL/AGPL-tagged runtime packages were found in the installed dependency metadata. The sharp/libvips native chain carries LGPL-3.0-or-later obligations, which differ from GPL/AGPL and must be retained when distributing those binaries. Do not describe the entire dependency tree as MIT.
- blob@0.0.4 lacks an npm license field but its README and upstream repository explicitly declare MIT. Its complete upstream notice is included at docs/licenses/blob-MIT.txt. png-js and webgl-constants were also verified MIT despite incomplete package metadata.

## Architecture invariant

Image -> preprocessing -> recognition masks/vectors -> coordinate and unit conversion -> editable layout schema -> SVG, Three.js and collision geometry.

The schema owns wall segments, openings, room polygons, units, ceiling height and material references. Room bounding rectangles are derived caches only. OBJ/GLB output is a non-editable reference attachment. Mesh-only responses are rejected rather than presented as editable renovation geometry.

Source links: the five repositories above; https://pymupdf.io/licensing ; https://github.com/CubiCasa/CubiCasa5k/blob/master/LICENSE ; https://github.com/webmodules/blob/blob/master/LICENSE .
