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

生成器位于 `scripts/generate-assets.mjs`，输出到 `public/generated/`：

| 资产 | 用途 |
| --- | --- |
| `tile-albedo.png` | 瓷砖基础颜色 |
| `tile-normal.png` | 瓷砖和砖缝法线 |
| `wet-mask.png` | 随机地面水渍遮罩 |
| `wet-roughness.png` | 湿润区域粗糙度 |
| `gi-lightmap.png` | 窗口日光与室内反弹光 GI |
| `light-shaft.png` | 高窗光束衰减纹理 |
| `probe-p*.png` / `probe-n*.png` | 室内反射探针六个方向 |

`npm run dev` 和 `npm run build` 会通过 `predev`、`prebuild` 自动执行资产生成，无需手动提前运行。

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
|   |-- main.js                 场景、交互、材质与渲染管线
|   `-- style.css               页面与 HUD 样式
|-- scripts/
|   |-- generate-assets.mjs     程序化资产离线生成器
|   `-- verify.mjs              Playwright 浏览器验证
|-- public/generated/           运行时加载的生成资产
|-- package.json
`-- README.md
```

## 性能说明

渲染分辨率会根据设备像素比和视口宽度进行限制。桌面端使用较高像素比，移动端自动降低内部渲染分辨率。SSR、软阴影、Bloom 和折射都具有较高 GPU 开销；低性能设备可通过降低浏览器窗口尺寸改善帧率。
