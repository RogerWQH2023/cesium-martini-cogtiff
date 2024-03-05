import {
  Cartographic,
  Rectangle,
  Ellipsoid,
  WebMercatorTilingScheme,
  Math as CMath,
  Event as CEvent,
  BoundingSphere,
  QuantizedMeshTerrainData,
  OrientedBoundingBox,
  TerrainProvider,
  Credit,
  Resource,
  TilingScheme,
} from "cesium";
import WorkerFarm from "./worker-farm";
import { TerrainWorkerInput, decodeTerrain } from "./worker-util";
import DefaultTiffHeightmapResource, {
  HeightmapResource,
} from "./tiff-heightmap-resource";
import { emptyMesh, TerrainWorkerOutput } from "./worker-util";
import { TypedArray } from "ndarray";

// https://github.com/CesiumGS/cesium/blob/1.68/Source/Scene/MapboxImageryProvider.js#L42

export interface TileCoordinates {
  x: number;
  y: number;
  z: number;
}

interface TiffMartiniTerrainOpts {
  url: string | File | Blob;
  ellipsoid?: Ellipsoid;
  detailScalar?: number;
  minimumErrorLevel?: number;
  maxWorkers?: number;
  interval?: number;
  offset?: number;
  minZoomLevel?: number;
  fillPoles?: boolean;
  requestVertexNormals?: boolean;
  requestWaterMask?: boolean;
}

class StretchedTilingScheme extends WebMercatorTilingScheme {
  tileXYToRectangle(
    x: number,
    y: number,
    level: number,
    res: Rectangle
  ): Rectangle {
    let result = super.tileXYToRectangle(x, y, level);
    if (y == 0) {
      //console.log("Top row", res, y, level);
      result.north = Math.PI / 2;
    }
    if (y + 1 == Math.pow(2, level)) {
      result.south = -Math.PI / 2;
    }
    return result;
  }
}

export default class TiffMartiniTerrainProvider {
  hasWaterMask = false;
  hasVertexNormals = false;
  credit = new Credit("Mapbox");
  ready: boolean;
  readyPromise: Promise<boolean>;
  errorEvent = new CEvent();
  tilingScheme: TilingScheme;
  ellipsoid: Ellipsoid;
  workerFarm: WorkerFarm | null = null;
  inProgressWorkers: number = 0;
  levelOfDetailScalar: number;
  maxWorkers: number = 5;
  minError: number = 0.1;
  minZoomLevel: number;
  fillPoles: boolean = true;
  _errorAtMinZoom: number = 1000;

  resource: HeightmapResource;
  interval: number;
  offset: number;

  RADIUS_SCALAR = 1.0;
  requestVertexNormals: boolean | undefined;
  requestWaterMask: boolean | undefined;
  availability = undefined;

  constructor(opts: TiffMartiniTerrainOpts) {
    this.resource = new DefaultTiffHeightmapResource({ url: opts.url });

    this.interval = opts.interval ?? 0.1;
    this.offset = opts.offset ?? -10000;
    this.maxWorkers = opts.maxWorkers ?? 5;
    this.minZoomLevel = opts.minZoomLevel ?? 3;
    this.fillPoles = opts.fillPoles ?? true;

    this.levelOfDetailScalar = (opts.detailScalar ?? 4.0) + CMath.EPSILON5;

    this.ready = true;
    this.readyPromise = Promise.resolve(true);
    this.minError = opts.minimumErrorLevel ?? 0.1;
    this.requestVertexNormals = opts.requestVertexNormals;
    this.requestWaterMask = opts.requestWaterMask;

    this.errorEvent.addEventListener(console.log, this);
    this.ellipsoid = opts.ellipsoid ?? Ellipsoid.WGS84;
    if (this.maxWorkers > 0) {
      this.workerFarm = new WorkerFarm();
    }

    let scheme = WebMercatorTilingScheme;
    if (this.fillPoles) {
      scheme = StretchedTilingScheme;
    }
    this.tilingScheme = new scheme({
      numberOfLevelZeroTilesX: 1,
      numberOfLevelZeroTilesY: 1,
      ellipsoid: this.ellipsoid,
    });
    //this.tilingScheme = this.resource.getTilingScheme();

    this._errorAtMinZoom = this.errorAtZoom(this.minZoomLevel);
  }

  requestTileGeometry(x: number, y: number, z: number, request: any) {
    // Look for tiles both below the zoom level and below the error threshold for the zoom level at the equator...

    if (
      z < this.minZoomLevel ||
      this.scaledErrorForTile(x, y, z) > this._errorAtMinZoom
    ) {
      // If we are below the minimum zoom level, we return empty heightmaps
      // to avoid unnecessary requests for low-resolution data.
      return Promise.resolve(this.emptyMesh(x, y, z));
    }

    // Note: we still load a TON of tiles near the poles. We might need to do some overzooming here...

    if (this.inProgressWorkers > this.maxWorkers) return undefined;
    this.inProgressWorkers += 1;
    return this.processTile(x, y, z).finally(() => {
      this.inProgressWorkers -= 1;
    });
  }

  async processTile(x: number, y: number, z: number) {
    // Something wonky about our tiling scheme, perhaps
    // 12/2215/2293 @2x
    //const url = `https://a.tiles.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}${hires}.${this.format}?access_token=${this.accessToken}`;
    try {
      const { tileSize, getTilePixels } = this.resource;
      let px = await getTilePixels({ x, y, z });
      if (!px) throw Error("no pixels at " + `x: ${x}, y: ${y}, z: ${z}`);
      //console.log(px);
      let pixelData: TypedArray | undefined = px.data;
      console.log(pixelData);
      console.log(pixelData.buffer);
      //console.log(this.tilingScheme);

      const tileRect = this.tilingScheme.tileXYToRectangle(x, y, z);
      //console.log(1);
      ///const center = Rectangle.center(tileRect);

      const err = this.errorAtZoom(z);
      //console.log(2);

      let maxLength = this.maxVertexDistance(tileRect);
      //console.log(3);

      const params: TerrainWorkerInput = {
        imageData: pixelData,
        maxLength,
        x,
        y,
        z,
        errorLevel: err,
        ellipsoidRadius: this.ellipsoid.maximumRadius,
        tileSize,
        interval: this.interval,
        offset: this.offset,
      };

      let res;
      /* if (this.workerFarm != null) {
        console.log(4);
        console.log(pixelData.buffer);
        res = await this.workerFarm.scheduleTask(params, [pixelData.buffer]);
      } else { */
      console.log(5);
      res = decodeTerrain(params);
      //}

      pixelData = undefined;
      px = undefined;
      return this.createQuantizedMeshData(tileRect, err, res);
    } catch (err) {
      console.log(err);
      return this.emptyMesh(x, y, z);
    }
  }

  errorAtZoom(zoom: number) {
    return Math.max(
      this.getLevelMaximumGeometricError(zoom) / this.levelOfDetailScalar,
      this.minError
    );
  }

  scaledErrorForTile(x: number, y: number, z: number) {
    const tileRect = this.tilingScheme.tileXYToRectangle(x, y, z);
    const center = Rectangle.center(tileRect);
    return this.errorAtZoom(z) / Math.pow(1 - Math.sin(center.latitude), 2);
  }

  maxVertexDistance(tileRect: Rectangle) {
    return Math.ceil(2 / tileRect.height);
  }

  emptyMesh(x: number, y: number, z: number) {
    const tileRect = this.tilingScheme.tileXYToRectangle(x, y, z);
    const center = Rectangle.center(tileRect);

    const latScalar = Math.min(Math.abs(Math.sin(center.latitude)), 0.995);
    let v = Math.max(
      Math.ceil((200 / (z + 1)) * Math.pow(1 - latScalar, 0.25)),
      4
    );
    const output = emptyMesh(v);
    const err = this.errorAtZoom(z);
    return this.createQuantizedMeshData(tileRect, err, output);
  }

  createQuantizedMeshData(
    tileRect: Rectangle,
    errorLevel: number,
    workerOutput: TerrainWorkerOutput
  ) {
    const {
      minimumHeight,
      maximumHeight,
      quantizedVertices,
      indices,
      westIndices,
      southIndices,
      eastIndices,
      northIndices,
    } = workerOutput;

    const err = errorLevel;
    const skirtHeight = err * 20;

    const center = Rectangle.center(tileRect);

    // Calculating occlusion height is kind of messy currently, but it definitely works
    const halfAngle = tileRect.width / 2;
    const dr = Math.cos(halfAngle); // half tile width since our ref point is at the center

    let occlusionHeight = dr * this.ellipsoid.maximumRadius + maximumHeight;
    if (halfAngle > Math.PI / 4) {
      occlusionHeight = (1 + halfAngle) * this.ellipsoid.maximumRadius;
    }

    const occlusionPoint = new Cartographic(
      center.longitude,
      center.latitude,
      occlusionHeight
      // Scaling factor of two just to be sure.
    );

    const horizonOcclusionPoint = this.ellipsoid.transformPositionToScaledSpace(
      Cartographic.toCartesian(occlusionPoint)
    );

    let orientedBoundingBox = OrientedBoundingBox.fromRectangle(
      tileRect,
      minimumHeight,
      maximumHeight,
      this.tilingScheme.ellipsoid
    );
    let boundingSphere =
      BoundingSphere.fromOrientedBoundingBox(orientedBoundingBox);

    // SE NW NE
    // NE NW SE

    let result = new QuantizedMeshTerrainData({
      minimumHeight,
      maximumHeight,
      quantizedVertices,
      indices,
      boundingSphere,
      orientedBoundingBox,
      horizonOcclusionPoint,
      westIndices,
      southIndices,
      eastIndices,
      northIndices,
      westSkirtHeight: skirtHeight,
      southSkirtHeight: skirtHeight,
      eastSkirtHeight: skirtHeight,
      northSkirtHeight: skirtHeight,
      childTileMask: 15,
    });

    return result;
  }

  getLevelMaximumGeometricError(level: number) {
    const levelZeroMaximumGeometricError =
      TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
        this.tilingScheme.ellipsoid,
        65,
        this.tilingScheme.getNumberOfXTilesAtLevel(0)
      );

    // Scalar to control overzooming
    // also seems to control zooming for imagery layers
    const scalar = this.resource.tileSize / 256;

    return levelZeroMaximumGeometricError / scalar / (1 << level);
  }

  getTileDataAvailable(x: number, y: number, z: number) {
    return this.resource.getTileDataAvailable({ x, y, z });
  }

  loadTileDataAvailability(x: number, y: number, z: number) {
    return undefined;
  }
}
