# Real-world GeoTIFF manual fixtures

Small matching DEM/orthophoto pair for manual testing of GeoTIFF import and
orthophoto draping.

- Area: Denver, Colorado, USA
- Bbox: `-105.000,39.739,-104.997,39.742` in EPSG:4326
- Approximate footprint: 257 m east-west by 333 m north-south

Files:

- `denver-wgs84-dtm.tif`
  - Source: USGS 3DEP Elevation ImageServer
  - Export:
    `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=-105.000,39.739,-104.997,39.742&bboxSR=4326&imageSR=4326&size=256,256&format=tiff&pixelType=F32&f=image`
  - Raster: 256 x 256, Float32, single-band elevation

- `denver-wgs84-orthophoto.tif`
  - Source: USGS NAIP Imagery ImageServer
  - Export:
    `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox=-105.000,39.739,-104.997,39.742&bboxSR=4326&imageSR=4326&size=512,512&format=tiff&f=image`
  - Raster: 512 x 512, 8-bit RGBA orthophoto

Both files are exported as EPSG:4326 GeoTIFFs. That is intentional: this pair
exercises geographic GeoTIFF placement and degree-to-ground-meter footprint
conversion.
