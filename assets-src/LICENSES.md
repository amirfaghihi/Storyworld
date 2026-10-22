# Raw asset sources (this folder is gitignored except this file and geodata/)

| Path | Source | Licence |
|---|---|---|
| geodata/sketch-map-of-middle-earth.svg | https://commons.wikimedia.org/wiki/File:Sketch_Map_of_Middle-earth.svg (Ian Alexander) | CC BY-SA 4.0 |

## Natural Earth (Earth globe geography)

- Files: `geodata/natural-earth/ne_110m_land.geojson`, `ne_110m_lakes.geojson`, `ne_110m_rivers_lake_centerlines.geojson`, `ne_110m_glaciated_areas.geojson`, `ne_50m_geography_regions_polys.geojson`, `ne_110m_admin_0_countries.geojson`
- Source: https://www.naturalearthdata.com/ (via github.com/nvkelso/natural-earth-vector)
- License: public domain. No attribution required; credited anyway in CREDITS.md.
- Use: rasterized into `public/worlds/earth/terrain.png` by `scripts/build-globe.ts`.
