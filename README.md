# Earth Pulse — NASA Texture Edition

A deploy-ready static Three.js web app that visualises the natural rhythm of Earth using NASA imagery.

## What changed from the MVP

- Uses NASA Blue Marble Next Generation as the day-side Earth texture.
- Uses NASA VIIRS Black Marble as the night-side Earth texture.
- Fetches both textures from NASA GIBS WMS at page load.
- Adds visible data credits in the app.
- Keeps the previous procedural fallback in case the NASA imagery cannot load.
- Still requires no local `npm install`.

## Data sources

The app fetches global 2:1 equirectangular WMS images from:

```text
https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi
```

Layers used:

```text
BlueMarble_NextGeneration
VIIRS_Black_Marble
```

Important note: Blue Marble and the classic Black Marble composite are not live real-time observations. In this app, “live fetch” means the browser fetches imagery from NASA’s public service at runtime rather than storing the texture files inside your repo.

## Deployment on Vercel

1. Upload these files to the root of your GitHub repository.
2. Go to Vercel.
3. Import the GitHub repository.
4. Framework preset: **Other**
5. Build command: leave blank.
6. Output directory: leave blank.
7. Deploy.

## File structure

```text
your-repo/
├── index.html
├── styles.css
├── app.js
├── vercel.json
└── README.md
```
