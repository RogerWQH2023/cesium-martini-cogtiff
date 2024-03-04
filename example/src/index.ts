import {
  ArcGisMapServerImageryProvider,
  Cartesian3,
  ImageryLayer,
  Resource,
  Viewer,
  Math as CMath,
} from "cesium";
import "./index.css";
import {
  MartiniTerrainProvider,
  TiffMartiniTerrainProvider,
} from "@zjugis/cesium-martini";

import TIFFImageryProvider from "tiff-imagery-provider";
import GeoTIFF, { Pool, fromUrl, fromBlob, GeoTIFFImage } from "geotiff";

const viewer = new Viewer("cesiumContainer", {
  baseLayer: ImageryLayer.fromProviderAsync(
    ArcGisMapServerImageryProvider.fromUrl(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
      {
        enablePickFeatures: false,
      }
    ),
    {}
  ),
  baseLayerPicker: false,
  animation: false,
  fullscreenButton: false,
  geocoder: false,
  //homeButton: false,
  selectionIndicator: true,
  timeline: false,
  navigationHelpButton: false,
  shouldAnimate: true,
  useBrowserRecommendedResolution: false,
  orderIndependentTranslucency: false,
});

/* const terrainLayer = new MartiniTerrainProvider({
  url: new Resource({
    url: "https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}@2x.webp",
    queryParameters: {
      access_token:
        "pk.eyJ1Ijoic3ZjLW9rdGEtbWFwYm94LXN0YWZmLWFjY2VzcyIsImEiOiJjbG5sMnFlZ28wb2d5MnFtb2xnMG90OW96In0.IE8Vqs0NTzCY0WqPzV9kcw",
    },
  }),
  requestVertexNormals: true,
}); */
const terrainLayer = new TiffMartiniTerrainProvider({
  url: "https://ddeassets-file.oss-cn-hongkong.aliyuncs.com/geophysics/global_map/gebco_dem.tif",
});

viewer.scene.terrainProvider = terrainLayer;

const extent = Cartesian3.fromDegrees(14.5481193, -21.433786, 8000);
viewer.camera.setView({
  destination: extent,
  orientation: {
    heading: CMath.toRadians(0),
    pitch: CMath.toRadians(-15),
    roll: 0.0,
  },
});

const provider = await TIFFImageryProvider.fromUrl(
  //"https://ddeassets-file.oss-cn-hongkong.aliyuncs.com/geophysics/global_map/gebco_dem.tif"
  "https://tiff-imagery-provider.opendde.com/cogtif.tif"
);

viewer.imageryLayers.addImageryProvider(provider);

const resource = await fromUrl(
  "https://ddeassets-file.oss-cn-hongkong.aliyuncs.com/geophysics/global_map/gebco_dem.tif"
);
console.log(resource);
const image = await resource.getImage(0); // by default, the first image is read.

const width = image.getWidth();
const height = image.getHeight();
const tileWidth = image.getTileWidth();
const tileHeight = image.getTileHeight();
const samplesPerPixel = image.getSamplesPerPixel();
console.log(width);
console.log(height);
console.log(tileWidth);
console.log(tileHeight);
console.log(samplesPerPixel);

// when we are actually dealing with geo-data the following methods return
// meaningful results:
const origin = image.getOrigin();
const resolution = image.getResolution();
const bbox = image.getBoundingBox();
console.log(origin);
console.log(resolution);
console.log(bbox);

//const data = await image.readRasters();
//console.log(data);

// 获取波段数
const samples = image.getSamplesPerPixel();
console.log(samples);
// 获取nodata值
const noData = image.getGDALNoData();
console.log(noData);
