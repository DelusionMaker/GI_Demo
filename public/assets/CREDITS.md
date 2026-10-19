# 资产来源与许可

## LittlestTokyo.glb

- 作者：Glen Fox
- 许可：CC BY 4.0
- 来源：<https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf>
- 用途：three.js 官方示例中的城市模型，作为带贴图 / 蒙皮的真实资产与 IBL 对照。
- 处理：Draco 压缩；运行时用 `SkeletonUtils.clone` 克隆蒙皮，并 traverse 替换为 `GBufferMaterial`（保留 baseColor 贴图 / side / alphaTest）。

## kloppenheim_06_puresky_1k.hdr

- 来源：Poly Haven
- 许可：CC0
- 页面：<https://polyhaven.com/a/kloppenheim_06_puresky>
- 用途：户外 IBL 环境贴图（1K equirectangular HDR）。

## Draco 解码器

- 来源：three.js `examples/jsm/libs/draco/`（Google Draco，Apache 2.0）
- 文件：`public/draco/draco_decoder.js`、`draco_decoder.wasm`、`draco_wasm_wrapper.js`
- 用途：运行时解压 LittlestTokyo 的 Draco 几何。
