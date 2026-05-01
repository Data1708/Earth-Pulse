# Earth Pulse — Dynamic Data Layers

Static Vercel-ready Three.js app with NASA data layers and user-controlled time speed.

## What changed

- Removed the preset "rhythm" mode buttons.
- Added a direct speed slider for the simulation clock.
- Added user toggles for:
  - Clouds from recent corrected-reflectance imagery
  - IMERG precipitation
  - GHRSST MUR sea-surface temperature
  - Ocean-flow particles
  - Black Marble night lights and activity pulses
  - Season/orbit geometry
- Added on-page data status and data source credits.

## Data sources used

Browser-fetched visual layers:

```text
NASA GIBS WMS endpoint:
https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi
```

Layers requested:

```text
BlueMarble_NextGeneration
VIIRS_Black_Marble
VIIRS_NOAA21_CorrectedReflectance_TrueColor
VIIRS_SNPP_CorrectedReflectance_TrueColor
MODIS_Terra_CorrectedReflectance_TrueColor
IMERG_Precipitation_Rate
GHRSST_L4_MUR_Sea_Surface_Temperature
```

## Important implementation note

This is still a static site. It has no server, database or local npm build step.

The app fetches visual raster layers directly from NASA GIBS at runtime. For ocean currents, the app uses lightweight animated stream particles informed by major ocean current pathways and NASA ECCO/OSCAR sources. It does not download heavy live current-vector NetCDF files in the browser.

A future backend version could periodically fetch and preprocess OSCAR or RTOFS current vectors into small JSON or texture tiles.

## Deployment on Vercel

1. Upload all files to the root of your GitHub repository.
2. In Vercel, import the GitHub repository.
3. Framework preset: **Other**.
4. Build command: leave blank.
5. Output directory: leave blank.
6. Deploy.

## File structure

```text
your-repo/
├── index.html
├── styles.css
├── app.js
├── vercel.json
└── README.md
```
