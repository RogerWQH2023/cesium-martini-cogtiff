import {
  Cartographic,
  Rectangle,
  Ellipsoid,
  WebMercatorTilingScheme,
  TerrainProvider,
  Math as CMath,
  Event as CEvent,
  Cartesian3,
  BoundingSphere,
  QuantizedMeshTerrainData,
  HeightmapTerrainData,
  // @ts-ignore
  OrientedBoundingBox,
  Credit
} from "cesium"
import ndarray from 'ndarray'
import getPixels from 'get-pixels'
import Martini from '@mapbox/martini'

// https://github.com/CesiumGS/cesium/blob/1.68/Source/Scene/MapboxImageryProvider.js#L42

enum ImageFormat {
  WEBP = 'webp',
  PNG = 'png',
  PNGRAW = 'pngraw'
}

interface TileCoordinates {
  x: number
  y: number
  z: number
}

interface MapboxTerrainOpts {
  format: ImageFormat
  ellipsoid?: Ellipsoid
  accessToken: string
  highResolution?: boolean
  fillValue?: number
}

class MapboxTerrainProvider {
  martini: any
  hasWaterMask = false
  hasVertexNormals = false
  credit = new Credit("Mapbox")
  ready: boolean
  readyPromise: Promise<boolean>
  availability = null
  errorEvent = new CEvent()
  tilingScheme: TerrainProvider["tilingScheme"]
  ellipsoid: Ellipsoid
  accessToken: string
  format: ImageFormat
  highResolution: boolean
  tileSize: number = 256
  fillValue: number = 0
  meshErrorScalar: number = 1

  // A quick hack to getting things working on Mars
  RADIUS_SCALAR: number = 1

  // @ts-ignore
  constructor(opts: MapboxTerrainOpts = {}) {

    //this.martini = new Martini(257);
    this.highResolution = opts.highResolution ?? false
    this.tileSize = this.highResolution ? 512 : 256
    this.fillValue = opts.fillValue ?? 0

    this.martini = new Martini(this.tileSize+1)
    this.ready = true
    this.readyPromise = Promise.resolve(true)
    this.accessToken = opts.accessToken

    this.errorEvent.addEventListener(console.log, this);
    this.ellipsoid = opts.ellipsoid ?? Ellipsoid.WGS84
    this.format = opts.format ?? ImageFormat.PNG

    this.tilingScheme = new WebMercatorTilingScheme({
      numberOfLevelZeroTilesX: 1,
      numberOfLevelZeroTilesY: 1,
      ellipsoid: this.ellipsoid
    })

  }

  async getPixels(url: string, type=""): Promise<ndarray<number>> {
    return new Promise((resolve, reject)=>{
      getPixels(url, type, (err, array)=>{
        if (err != null) reject(err)
        resolve(array)
      })
    })
  }

  async requestMapboxTile (x, y, z) {
    const mx = this.tilingScheme.getNumberOfYTilesAtLevel(z)
    const err = this.getLevelMaximumGeometricError(z)

    // Something wonky about our tiling scheme, perhaps
    // 12/2215/2293 @2x
    const url =  this.buildTileURL({x,y,z})


    try {
      const pxArray = await this.getPixels(url)

      const terrain = this.mapboxTerrainToGrid(pxArray)

      // set up mesh generator for a certain 2^k+1 grid size
      // generate RTIN hierarchy from terrain data (an array of size^2 length)
      const tile = this.martini.createTile(terrain);

      // get a mesh (vertices and triangles indices) for a 10m error
      //console.log(`Error level: ${err}`)
      const mesh = tile.getMesh(err*this.meshErrorScalar);

      return await this.createQuantizedMeshData(x, y, z, tile, mesh)
    } catch(err) {
      // We fall back to a heightmap
      const v = Math.max(32-4*z, 4)
      return this.emptyHeightmap(v)
    }
  }

  emptyHeightmap(samples) {
    return new HeightmapTerrainData({
      buffer: new Uint8Array(Array(samples*samples).fill(this.fillValue)),
      width: samples,
      height: samples
    })
  }

  buildTileURL(tileCoords: TileCoordinates) {
    const {z,x,y} = tileCoords
    const hires = this.highResolution ? '@2x' : ''
    return `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}${hires}.${this.format}?access_token=${this.accessToken}`
  }

  preprocessHeight(x: number, y: number, height: number): number {
    return height
  }

  mapboxTerrainToGrid(png: ndarray<number>): Float32Array {
      const gridSize = png.shape[0] + 1;
      const terrain = new Float32Array(gridSize * gridSize);
      const tileSize = png.shape[0];

      // decode terrain values
      for (let y = 0; y < tileSize; y++) {
          for (let x = 0; x < tileSize; x++) {
              const r = png.get(x,y,0);
              const g = png.get(x,y,1);
              const b = png.get(x,y,2);
              const height = ((r * 256.0 + g ) * 256.0 + b) / 10.0 - 10000.0;
              // A sketchy shim to solve weird nodata values in Syrtis Major data
              terrain[y * gridSize + x] = this.preprocessHeight(x , y, height)
          }
      }
      // backfill right and bottom borders
      for (let x = 0; x < gridSize - 1; x++) {
        terrain[gridSize * (gridSize - 1) + x] = terrain[gridSize * (gridSize - 2) + x];
      }
      for (let y = 0; y < gridSize; y++) {
        terrain[gridSize * y + gridSize - 1] = terrain[gridSize * y + gridSize - 2];
      }
      return terrain;
  }

  async createQuantizedMeshData (x, y, z, tile, mesh) {
    const err = this.getLevelMaximumGeometricError(z)
    const skirtHeight = err*5

    const xvals = []
    const yvals = []
    const heightMeters = []
    const northIndices = []
    const southIndices = []
    const eastIndices = []
    const westIndices = []

    for (let ix = 0; ix < mesh.vertices.length/2; ix++) {
      const vertexIx = ix
      const px = mesh.vertices[ix*2]
      const py = mesh.vertices[ix*2+1]
      heightMeters.push(tile.terrain[py*(this.tileSize+1)+px])

      if (py == 0) northIndices.push(vertexIx)
      if (py == this.tileSize) southIndices.push(vertexIx)
      if (px == 0) westIndices.push(vertexIx)
      if (px == this.tileSize) eastIndices.push(vertexIx)

      // This saves us from out-of-range values like 32768
      const scalar = 32768/this.tileSize
      let xv = px*scalar
      let yv = (this.tileSize-py)*scalar

      xvals.push(xv)
      yvals.push(yv)
    }

    const maxHeight = Math.max.apply(this, heightMeters)
    const minHeight = Math.min.apply(this, heightMeters)

    const heights = heightMeters.map(d =>{
      if (maxHeight-minHeight < 1) return 0
      return (d-minHeight)*(32767/(maxHeight-minHeight))
    })

    const tileRect = this.tilingScheme.tileXYToRectangle(x, y, z)
    const tileCenter = Cartographic.toCartesian(Rectangle.center(tileRect))
    // Need to get maximum distance at zoom level
    // tileRect.width is given in radians
    // cos of half-tile-width allows us to use right-triangle relationship
    const cosWidth = Math.cos(tileRect.width/2)// half tile width since our ref point is at the center
    // scale max height to max ellipsoid radius
    // ... it might be better to use the radius of the entire
    const ellipsoidHeight = maxHeight/this.ellipsoid.maximumRadius*this.RADIUS_SCALAR
    // cosine relationship to scale height in ellipsoid-relative coordinates
    const occlusionHeight = (1+ellipsoidHeight)/cosWidth

    const scaledCenter = Ellipsoid.WGS84.transformPositionToScaledSpace(tileCenter)*this.RADIUS_SCALAR
    const horizonOcclusionPoint = new Cartesian3(scaledCenter.x, scaledCenter.y, occlusionHeight)

    let orientedBoundingBox = null
    let boundingSphere: BoundingSphere
    if (tileRect.width < CMath.PI_OVER_TWO + CMath.EPSILON5) {
      // @ts-ignore
      orientedBoundingBox = OrientedBoundingBox.fromRectangle(tileRect, minHeight, maxHeight)
      // @ts-ignore
      boundingSphere = BoundingSphere.fromOrientedBoundingBox(orientedBoundingBox)
    } else {
      // If our bounding rectangle spans >= 90º, we should use the entire globe as a bounding sphere.
      boundingSphere = new BoundingSphere(
        Cartesian3.ZERO,
        // radius (seems to be max height of Earth terrain?)
        6379792.481506292 * this.RADIUS_SCALAR
      )
    }

    const triangles = new Uint16Array(mesh.triangles)

    // @ts-ignore

    // If our tile has greater than ~1º size
    if (tileRect.width > 0.1) {
      // We need to be able to specify a minimum number of triangles...
      return this.emptyHeightmap(64)
    }

    const quantizedVertices = new Uint16Array(
      //verts
      [...xvals, ...yvals, ...heights]
    )

    // SE NW NE
    // NE NW SE

    return new QuantizedMeshTerrainData({
      minimumHeight: minHeight,
      maximumHeight: maxHeight,
      quantizedVertices,
      indices : triangles,
      // @ts-ignore
      boundingSphere,
      // @ts-ignore
      orientedBoundingBox,
      // @ts-ignore
      horizonOcclusionPoint,
      westIndices,
      southIndices,
      eastIndices,
      northIndices,
      westSkirtHeight : skirtHeight,
      southSkirtHeight : skirtHeight,
      eastSkirtHeight : skirtHeight,
      northSkirtHeight : skirtHeight,
      childTileMask: 15
    })
  }

  async requestTileGeometry (x, y, z, request) {
    try {
      const mapboxTile = await this.requestMapboxTile(x,y,z)
      return mapboxTile
    } catch(err) {
      console.log(err)
    }
  }

  getLevelMaximumGeometricError (level) {
    const levelZeroMaximumGeometricError = TerrainProvider
      .getEstimatedLevelZeroGeometricErrorForAHeightmap(
        this.tilingScheme.ellipsoid,
        65,
        this.tilingScheme.getNumberOfXTilesAtLevel(0)
      )

    // Scalar to control overzooming
    // also seems to control zooming for imagery layers
    const scalar = this.highResolution ? 8 : 4

    return levelZeroMaximumGeometricError / (1 << level)
  }

  getTileDataAvailable(x, y, z) {
    return z <= 15
  }
}

export default MapboxTerrainProvider
