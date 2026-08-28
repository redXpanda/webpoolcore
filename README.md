# 池核漫游

一个基于 Three.js 的网页版 3D 池核自由探索场景。场景由多个封闭的室内泳池空间组成，包含 50 米深池体、瓷砖建筑、高窗日光、水面折射、湿地反射和程序合成环境音。

项目中的模型由 Three.js 几何体构建；纹理、GI 光照贴图和反射探针由 Node.js 脚本离线生成。浏览器运行时只负责加载生成资产和执行实时着色，不会动态生成纹理。

## 环境要求

- Node.js 20.19 或更高版本
- 支持 WebGL 2 的现代浏览器
- 建议使用独立显卡或高性能集成显卡
- 运行自动验证时需要安装 Google Chrome

## 本地运行

```bash
npm install
npm run dev
```

打开终端显示的地址，默认通常为：

```text
http://localhost:5173/
```

不要直接双击 `index.html` 或使用 `file://` 地址。ES Module 和纹理资源需要通过 HTTP 服务加载，否则浏览器会因 CORS 策略阻止脚本执行。

## 操作方式

| 操作 | 按键 |
| --- | --- |
| 移动 | `W` `A` `S` `D` |
| 观察 | 鼠标 |
| 加速 | `Shift` |
| 跳跃 | `Space` |
| 暂停或释放鼠标 | `Esc` |
| 开关声音 | 右上角声音按钮 |

点击“进入水域”后，浏览器会锁定鼠标指针并启动程序合成音效。

## 渲染特性

- 基于相机方向的第一人称移动和场景碰撞
- 50 米深的池体几何与多房间室内结构
- PBR 瓷砖材质、砖缝凹陷法线和离线 GI 光照贴图
- 高窗方向光、室内灯带、软阴影和静态环境补光
- 屏幕空间水体折射、菲涅尔反射、动态波纹和池底焦散
- 离线生成的六面体室内反射探针与盒投影校正
- 基于随机水渍贴图权重的湿地板 SSR 反射
- SMAA、Bloom、白平衡和 ACES Filmic Tone Mapping
- 基于 Web Audio API 的环境底噪、脚步、跳跃和滴水音效

后处理顺序：

```text
SSR -> 白平衡 -> Bloom -> SMAA -> ACES Output
```

## 离线资产

运行以下命令可以重新生成所有程序化资产：

```bash
npm run generate:assets
```

生成器位于 `scripts/generate-assets.mjs`，当前场景资产输出到：

```text
public/generated/sunset-pool-hall/
```

不同场景必须使用独立子目录，禁止直接写入 `public/generated/` 根目录。旧版场景资产保存在 `public/generated/legacy-pool-complex/`，重新生成当前场景时不会被覆盖。

| 资产 | 用途 |
| --- | --- |
| `tile-albedo.png` | 瓷砖基础颜色 |
| `tile-normal.png` | 瓷砖和砖缝法线 |
| `wet-mask.png` | 随机地面水渍遮罩 |
| `wet-roughness.png` | 湿润区域粗糙度 |
| `gi-lightmap.png` | RGBM HDR Lightmap Atlas；每个静态 Box 的六个面以及两侧拱墙均有独立 Chart |
| `gi-direction.png` | Directional Lightmap，记录各 texel 的主导入射光方向 |
| `gi-ao.png` | 4 米作用范围的独立 Baked AO Atlas |
| `light-shaft.png` | 高窗光束衰减纹理 |
| `caustic-shadow.png` | 建筑与拱窗投射到水底的焦散光照遮罩 |
| `probe-p*.png` / `probe-n*.png` | 室内反射探针六个方向 |

`npm run dev` 和 `npm run build` 会通过 `predev`、`prebuild` 自动执行资产生成，无需手动提前运行。

GI 烘焙参考 Unity Progressive Lightmapper：共享场景描述提供静态 AABB、材质反照率和窗口门户，并在烘焙前构建 BVH；每个 texel 从自身对应的世界位置与法线出发，使用余弦加权半球采样、窗口 Next Event Estimation、遮挡检测和三次漫反射 bounce。每个 texel 使用 48 个渐进累积样本，同时记录辐照度、主导入射方向和近场 AO。结果在各 Chart 内独立降噪和边缘扩张，再分别写入 RGBM HDR Lightmap、Directional Lightmap 和 Baked AO Atlas。运行时通过自定义 Three.js lightmap 解码路径恢复线性辐照度，并让法线贴图响应烘焙光方向。

静态间接光只来自烘焙 Lightmap；运行时不再叠加 AmbientLight、HemisphereLight 或窗口 RectAreaLight。DirectionalLight 仅负责与烘焙方向一致的太阳直射和动态阴影。`sunsetPoolHallBakeData.js` 是运行时 UV 分配与离线烘焙共用的静态布局来源，场景创建时会校验名称、尺寸和位置，防止 Atlas 与几何静默错位。

## 场景替换

运行时逻辑与场景实现已经分离：

- `src/main.js` 负责输入、音频、碰撞调用、折射预渲染和后处理。
- `src/scenes/sunsetPoolHall.js` 负责资产清单、出生点、材质、几何、灯光和场景描述。
- `scripts/generate-assets.mjs` 负责当前场景的离线纹理、GI 和反射探针烘焙。

新增场景时创建新的场景定义模块，并为它指定唯一的 `id` 与 `assets.basePath`。场景工厂需要返回以下运行时接口：

```js
{
  scene,
  collisionBoxes,
  waterMeshes,
  causticMeshes,
  ssrSurfaces,
  ssrMask,
  depth,
  describeLocation(position),
  update?.(deltaTime, elapsed),
}
```

最后在 `src/main.js` 中替换 `activeSceneDefinition` 即可切换场景，输入和渲染循环无需修改。

## 构建与验证

生成生产版本：

```bash
npm run build
```

预览生产版本：

```bash
npm run preview
```

在本地服务运行于 `http://localhost:4173/` 时执行桌面和移动端验证：

```bash
npm run verify
```

验证脚本会检查页面加载、画布输出、入口交互、资源请求和控制台错误。当前脚本使用 Windows 默认 Chrome 路径：

```text
C:/Program Files/Google/Chrome/Application/chrome.exe
```

## 项目结构

```text
.
|-- index.html                   页面入口
|-- src/
|   |-- main.js                 通用交互与渲染管线
|   |-- scenes/
|   |   `-- sunsetPoolHall.js   夕照水厅场景定义
|   `-- style.css               页面与 HUD 样式
|-- scripts/
|   |-- generate-assets.mjs     程序化资产离线生成器
|   `-- verify.mjs              Playwright 浏览器验证
|-- public/generated/           按场景 ID 隔离的生成资产
|-- package.json
`-- README.md
```

## 性能说明

渲染分辨率会根据设备像素比和视口宽度进行限制。桌面端使用较高像素比，移动端自动降低内部渲染分辨率。SSR、软阴影、Bloom 和折射都具有较高 GPU 开销；低性能设备可通过降低浏览器窗口尺寸改善帧率。
