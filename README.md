# Earth Pulse

A deploy-ready static Three.js web app that visualises the natural rhythm of Earth.

## What it shows

- Rotating Earth globe
- Day and night rhythm
- Procedural land, ocean, snow and atmosphere
- Moving cloud shell
- Night-side city lights
- Seasonal tilt mode
- Calm interactive orbit controls

## Deployment on Vercel

This project does not require local `npm install`.

1. Create a new GitHub repository.
2. Upload all files in this folder to the root of the repository.
3. Go to Vercel.
4. Import the GitHub repository.
5. Framework preset: **Other**
6. Build command: leave blank
7. Output directory: leave blank
8. Deploy.

## File structure

```text
earth-pulse/
├── index.html
├── styles.css
├── app.js
├── vercel.json
└── README.md
```

## Notes

This version is intentionally self-contained. It does not require NASA texture files. The Earth surface, clouds, city glow and atmosphere are generated procedurally in the browser using Three.js shaders.

Three.js is loaded from jsDelivr CDN through an import map in `index.html`.
