# F1 Racing Sim

A top-down Formula 1 racing game that runs entirely in the browser. No dependencies, no build step — just open `index.html`.

## Features

- Arcade F1 car physics: throttle, braking, reverse, and speed-sensitive steering
- Grass penalties — drop a wheel off the track and you lose grip and speed
- AI rival that follows the racing line and brakes for corners
- 3-lap race with live position, lap timing, last lap, and best lap
- Best lap saved to `localStorage` across sessions
- Countdown start, wrong-way warning, chequered-flag results screen
- Camera that follows your car, plus a live minimap

## Controls

| Key | Action |
| --- | --- |
| ↑ / W | Throttle |
| ↓ / S | Brake / Reverse |
| ← → / A D | Steer |
| R | Restart race |

## Run

Open `index.html` in any modern browser, or serve the folder:

```bash
npx serve .
```
