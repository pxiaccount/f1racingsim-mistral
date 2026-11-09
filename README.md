# F1 Racing Sim — 3D

A first-person 3D Formula 1 racing game that runs entirely in the browser, built with [three.js](https://threejs.org/) (loaded from a CDN). No build step — just open `index.html`.

## Features

- **First-person cockpit view** — camera sits in the driver's seat with a visible nose, front wing, halo pillar, and tires
- Arcade F1 physics: throttle, braking, reverse, speed-sensitive steering, and grass penalties off-track
- AI rival rendered as a full 3D car that follows the racing line and brakes for corners
- 3D circuit: asphalt ribbon, alternating red/white curbs, white edge lines, checkered start line, grandstands, sky and distance fog
- Dynamic FOV that widens with speed, camera lean when steering
- 3-lap race with countdown start, live position, lap timing, and best lap saved to `localStorage`
- Minimap with live car positions, wrong-way warning, results screen

## Controls

| Key | Action |
| --- | --- |
| ↑ / W | Throttle |
| ↓ / S | Brake / Reverse |
| ← → / A D | Steer |
| R | Restart race |

## Run

Open `index.html` in any modern browser (internet access required once for the three.js CDN import), or serve the folder:

```bash
npx serve .
```
