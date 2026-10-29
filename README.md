# Kerry's Room

The 3D room behind kerryobai.vercel.app. Plain ES modules on top of three.js
(r184 from jsDelivr), no build step.

Kerry runs on his own: `src/brain.js` keeps four needs (energy, fun, the urge
to build, the urge to move), scores every activity against them and Nairobi
time, and picks one. Activities are generator coroutines (fetch the controller,
walk to the bean bag, sit, play, react to goals, put it back).

| File | What it does |
| --- | --- |
| `src/room.js` | Walls, window, furniture, props, colliders, activity anchors |
| `src/character.js` | Loads Kerry, retargets clips, rig-agnostic IK (seat, legs, arms, head) |
| `src/brain.js` | Needs, utility choice, navigation, every activity |
| `src/physics.js` | Basketball: spin, rim, board, net, furniture, Kerry's capsule |
| `src/screens.js` | TV match, Jarvis terminal, Soko Stock globe, rack OLED, whiteboard |
| `src/audio.js` | Karplus-Strong guitar, dance groove, SFX, crickets |
| `src/sky.js` | Window view driven by Nairobi time |
| `src/ui.js` | HUD, panels, tour, camera, ball throwing, live SokoResult screen |
| `src/main.js` | Renderer, lights, post-processing, adaptive quality, loop |

## Run locally

Serve the folder with any static server. On localhost the import map points at
`/vendor/three/` (a checkout of three.js r184) and the character falls back to
three.js' Mixamo sample rigs, so you can work without the production assets.

Useful URL params: `?hour=21` (force Nairobi time), `?act=guitar` (start
activity), `?lq` (low quality), `?cam=x,y,z,tx,ty,tz`.

## Assets

Models, textures, HDR and tour audio live in the Vercel deployment under
`/assets` (`kerry-human.glb`, `idle.glb`, `walk.glb`, `jog.glb`, `dance.glb`,
`talk.glb`, `jump.glb`, `expr.glb`, `tex/*`, `room-env.hdr`, `audio/*`).
