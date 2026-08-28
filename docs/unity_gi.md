Unity 的间接光烘焙（Baked Global Illumination）目前主要由 **Progressive Lightmapper** 实现，历史上还有已经废弃的 **Enlighten**。下面分别说明它们的核心算法。

## 1. Progressive Lightmapper（当前主流方案）

Unity 从 2018 版本起把默认烘焙器换成了 Progressive Lightmapper，分为 **CPU** 和 **GPU** 两种后端，核心思路都是**基于蒙特卡洛路径追踪（Path Tracing）**。

### 基本流程

1. **UV 展开（Lightmap UV Unwrapping / Charting）**
   场景中标记为 "Contribute GI" 的静态物体会被展开成一套独立的 lightmap UV（如果没有手动提供，会自动生成 UV2）。每个物体的表面被划分成一系列 "chart"，并打包进一张或多张 lightmap 纹理中的像素（texel）。

2. **场景简化与加速结构构建**
   烘焙前会把参与 GI 的几何体转换成一个简化的路径追踪场景表示，构建 BVH（Bounding Volume Hierarchy）等加速结构，用于快速求交。GPU Lightmapper 用的是 AMD 的 **Radeon Rays** 做 GPU 加速的光线求交。

3. **对每个 texel 做半球采样（路径追踪核心）**
   对 lightmap 上每一个有效 texel（对应世界空间中的一小块表面）：
   - 以该点的法线为中心，做**余弦加权重要性采样（cosine-weighted importance sampling）**，在半球方向上发射光线；
   - 光线与场景求交后，根据命中点的材质（主要是漫反射反照率 albedo）计算能量传递，并继续弹射（多次反弹，Bounce 次数可配置，默认多次以模拟多次反弹的间接光）；
   - 直接光照通过对光源直接采样（含面积光的软阴影采样）计算；
   - 所有采样结果按蒙特卡洛方法取平均，得到该 texel 的辐照度（irradiance）。

4. **渐进式收敛（Progressive Refinement）**
   这也是名字 "Progressive" 的来源：烘焙不是一次性算到最终结果，而是不断增加采样数，编辑器里能看到 lightmap 从充满噪点逐渐收敛清晰，用户可以随时中断查看当前效果。

5. **降噪（Denoising）**
   因为路径追踪采样数有限会有噪点，Unity 集成了降噪器（如 Intel Open Image Denoise 或 NVIDIA OptiX 降噪，具体依后端而定）对 lightmap 做后处理去噪。

6. **方向性数据（Directional Lightmaps）**
   如果开启了 "Directional" 模式，除了辐照度贴图外还会额外烘焙一张记录主导光方向的贴图，用于让法线贴图在烘焙光照下也能有凹凸感（基于半球采样时同时记录各方向能量分布的主轴）。

7. **环境光遮蔽（Baked AO）与反射探针**
   AO 通常作为间接光照的一个乘法项单独烘焙；而间接光中的**镜面反射部分**并不烘焙进 lightmap（lightmap 只烘焙漫反射间接光），而是靠 **Reflection Probes** 单独处理。

### GPU vs CPU Lightmapper
- **CPU Lightmapper**：多线程 CPU 路径追踪，兼容性好但慢。
- **GPU Lightmapper**：把光线求交、着色计算搬到 GPU（通过 OpenCL/Radeon Rays），速度提升明显（官方宣称可达数倍到十几倍），算法本质相同，只是执行设备和部分实现细节（如 BVH 构建方式）不同。
节。