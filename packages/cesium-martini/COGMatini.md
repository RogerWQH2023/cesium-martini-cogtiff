# 笔记、更改想法、更改日志
## 记录
- terrainProvider本体：*terrain-provider.ts*
  - 读取数据：*heightmap-resource.ts*（在terrainProvider开头进行，此阶段读进来的是未加工的RGB数据）
    - ```this.resource = new DefaultHeightmapResource({ url: opts.url });```
  - 解码RGB，构建高程格式的瓦片的操作：*worker-util.ts*
    - ```mapboxTerrainToGrid```, ```createQuantizedMeshData```, ```decodeTerrain```
    - 构建三角网（在```decodeTerrain```内部调用）：*martini.ts*

## 更改想法：
- 由于Tiff读取方式不一样，所以可以想办法替换掉“读取数据：*heightmap-resource.ts*”的部分
- 又由于Tiff读进来就直接是高程，所以解码RGB，生成高程瓦片，构建三角网的步骤需要重新写，这个需要配合上面的数据读取。

## 日志
- 3/1前 测试各个包的用法，读代码，大致了解原理；做心理建设（哈哈）
- 3/4 
  - 首先尝试了直接用geotiff.js取代Cesium的Resources，但是写了一段以后发现各方面问题都很多。
  - 然后尝试了直接用TIFFImageryProvider替代Resources。（大炮打蚊子）
    - 经过尝试目前存在几个问题：
      - tiff-imagery-provider包未开放很多函数，属性（私有），且对于转地形的任务来说存在较多冗余（渲染等）。
      - 理想情况下直接使用TIFFImageryProvider类的_loadTile()方法获取瓦片，然后改良MartiniTerrainProvider中的processTile()方法即可初步实现功能（但是_loadTile()方法是私有方法，无法直接调用）。
  - 下一步计划：
    - 由于需要调用私有的函数，比较难以仅靠调用TIFFImageryProvider包完成全部功能。目前计划把整个TIFFImageryProvider包全部复制到这个包下面，然后再从TIFFImageryProvider上改出一个新版的DefaultHeightmapResource。
    - 在上一步能实现基本功能后，进行优化
      - 删除tiff渲染方面的功能，仅作为读取用
      - 删减变量的数量，合并必要的变量
- 3/5 
  - 今天首先尝试了完全移植TIFFImageryProvider包（失败）
    - 在道路尚不清晰的情况下难度较大（不知道什么要删什么不能删）。
    - 而且我对WebWorker不熟悉，存在很多只能懂得大意的代码
  - 目前先用(myObject as any).privateMethod();这种比较变态的方法强行调用了私有的_loadTile()，先尝试跑通之后的部分，然后再想办法做优化。
    - 经过对ProcessTile以及其中调用的work-util.ts的一系列处理瓦片的方法的改写，整套流程终于跑通了。。
    - 由于调用Worker处理地形时遇到了未知问题，所以目前强行先不使用Worker
    - 由于给的底图分辨率比较低，所以使用1.5倍缩放的地形。
    - 虽然从各种意义上都有很大问题，但是目前总算能看到地形了。
  - 之后需要再仔细研究一下两个包，然后仿照这次成功的案例，重新进行架构。