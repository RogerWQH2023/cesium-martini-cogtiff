# 笔记、更改想法、更改日志
由于函数太多了，脑子里记不过来，所以写一些日志
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

## 代办
