# World sorting — Phase 1

Presentation contract only. Gameplay position, pathing, and selection behavior are unchanged.

Named layers, back to front: `Backdrop`, `Ground`, `GroundOverlay`, `World`, `Atmosphere`, `WorldOverlay`. `Default` stays defined.

Depth-aware entities use `World` and sorting order `0`. Order comes from the shared custom axis `(0, 1, 1)` and the sprite pivot at the feet. A larger Y is farther. Tie-break is `z = index * 0.0001` on a presentation child, index `0..63`. That offset stays under one map pixel (`0.01` at 100 pixels per unit).

URP 2D reads the axis from `Renderer2D`, not from the camera. T0 confirmed a camera axis cannot override that renderer setting. Unity 6000.6 does not save `Camera.transparencySortMode` in the scene. `WorldSortingCameraBinding` applies the same axis when a camera enables. The live map uses that binding and does not keep a second axis.

Territory selection remains a `GroundOverlay` highlight. `WorldOverlay` order 30 is reserved for a future world-anchored selection marker and is not wired here.

Proof scene: `Scenes/WorldSortingProof.unity`, rebuilt from `RepWars > World Presentation > Sorting > Build Phase 1 Proof Scene`.

Water, audio, live props, armies, effects, and CharacterProduction are outside this phase. Mobile profiling is deferred.
