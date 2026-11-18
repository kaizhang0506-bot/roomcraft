# 可编辑户型语义协议（schemaVersion 2）

本协议是二维编辑、三维重建、房间导航和碰撞的共同数据源。识别服务先提供墙轴线、墙上开口和房间多边形；`lib/recognition.ts` 将其校准为米制 `Plan`。三维网格由这些数据派生，编辑操作始终修改语义数据，再重新生成显示几何。

## 项目版本与兼容

- `version: 1` 保留既有项目容器格式；`schemaVersion: 2` 表示当前可编辑户型协议，两者含义不同。
- `units: "m"` 明确编辑器中的空间长度为米；默认 `ceilingHeight` 为 2.8 米。
- 旧项目只有房间矩形时，`normalizePlan` 会补上四角多边形、材料引用和协议字段。已有 `polygon` 时保留其实际形状，包括 L 形等凹多边形。
- `rooms[].polygon` 是房间边界的依据；`x/y/width/depth` 是由多边形计算的兼容包围盒，不能用包围盒替代房间面积或碰撞轮廓。

完整类型见 `lib/plan.ts`，归一化与面积算法见 `lib/layout.ts`，输入约束见 `lib/validation.ts`。

## 编辑器数据与单位

平面坐标为二维 `{x,y}`，X 向右、Y 向下；三维显示将平面映射到 X/Z，垂直高度使用三维 Y。房间顶点不重复存放首顶点，由末点自动连回首点；当前协议支持简单多边形，不表达房间内孔。

| 字段 | 含义与单位 |
| --- | --- |
| `width/depth` | 项目平面范围，米 |
| `walls[].start/end` | 墙轴线两端，米 |
| `walls[].thickness/height` | 墙厚与墙高，米；墙体以轴线为中心 |
| `openings[].wallId` | 所属墙 ID，必须引用存在的墙 |
| `openings[].position` | 开口中心在墙起点到终点间的比例，`0..1`，无单位 |
| `openings[].width/height/sill` | 开口宽、高、下沿距地高度，米 |
| `rooms[].polygon` | 房间实际平面边界，米 |
| `furniture[].x/y` | 家具中心位置，米；尺寸为米，`rotation` 为度 |
| `nodes/routes` | 设计师添加的设备节点与线路，位置及高度为米 |
| `materials[]` 与 `materialId` | 材料定义及 ID 引用；房间可分别引用地面与墙面材料 |
| `verified` | 用户核对标记；识别或重新校准后为 `false` |

墙、门窗、房间、家具等对象使用稳定 ID。删除墙时清理关联开口；仅拖动墙不会推断整个房间的新拓扑，房间边界需在校正界面独立核对。房间多边形、墙和开口之间的关系仍需要设计师审核。

## 识别返回值到米制 Plan

CPU 服务返回 `provider: "cpu-geometric"` 与 `coordinateSpace: "pixel"`。这是服务交换协议，还不是保存到项目的米制协议。

| CPU 服务字段 | 服务单位 | 转换到编辑器 |
| --- | --- | --- |
| `wallSegments[].start/end`、`roomPolygons[].polygon` | working image 像素 | 减去 `originPixels`，再乘 `metersPerPixel` |
| 墙厚、开口宽 | working image 像素 | 乘 `metersPerPixel` |
| 墙高、`ceilingHeight`、开口高与窗台高 | 米 | 保持不变，不再缩放 |
| 开口 `position` | 沿墙比例 | 保持不变 |

`known_width_m` 指识别到的外墙轴线 X 方向总跨度，不含墙厚。服务用它校准 `metersPerPixel`；没有参考宽度时暂按 `0.02` 米/working px，并返回估计尺寸警告。它不执行尺寸 OCR。前端桥接参数名为 `knownWidthMeters`。

墙轴线最小 X/Y 作为归零原点。转换后保存以下对应关系：

```typescript
recognition.imageTransform = {
  originPixels: { x: 60, y: 60 }, // working image 上墙轴线包围盒的左上角
  metersPerPixel: 1 / 60,
  imageWidth: 720,
  imageHeight: 540,
};
```

变换公式为 `editorPoint = (workingPixel - originPixels) * metersPerPixel`；逆变换为 `workingPixel = editorPoint / metersPerPixel + originPixels`。校准平面比例时同时更新该变换的 `metersPerPixel`；墙高、窗高等垂直尺寸保持原值，需要单独核对。

`imageWidth/imageHeight` 是 EXIF 转正、白底合成及限尺寸处理后的 working image 大小，不能直接当作原始上传文件的像素大小。CPU 响应另外提供 `sourceImageSize` 供诊断；当前 Plan 不保存完整 EXIF/原图缩放链。底图显示需按 working image 的归一化坐标映射，或另外保留原图到 working image 的缩放和方向关系，不能仅平移原始像素。

识别结果总是 `recognition.needsReview: true`、`verified: false`，并保留 `warnings`。未关联墙 ID 的开口会被过滤并附加警告；只返回 OBJ/GLB、没有 `wallSegments` 的结果会被拒绝，不会伪装成可编辑户型。

## 静态网格与许可边界

CPU 服务可额外返回 `{format:"obj", editable:false, data:"..."}`，作为可审计静态预览。转换器只在 Plan 中保存 `sourceMesh` 的格式和只读标记，编辑器不以网格顶点作为墙、开口或房间数据。未带语义标注的 OBJ/GLB 无法可靠反推可装修编辑的拓扑；后续接入其他识别器仍需实现同一语义适配层。

当前 CPU 实现是原创几何算法：预处理 → 深色正交墙带 → 轴线合并 → 红/蓝开口标记 → 封闭区域轮廓。它不是已训练的语义分割模型，没有下载神经网络权重或 CubiCasa5K 数据。参考项目的许可审查与使用范围见 `reference-audit.md`；服务依赖许可见 `../recognition/THIRD_PARTY_LICENSES.md`。

## 原型验收路线与限制

`GET /api/recognize/sample` 会从 Python 服务 `GET /sample` 取回原创 PNG 和 `X-Known-Width-M`，再把图片实际 POST 到 `/recognize`，最后经过同一个语义转换器与验证器进入编辑器。每次运行均经过识别，不读取预先生成的 expected JSON 作为结果。

当前干净样例得到 7 段墙、2 个门、2 个窗、3 个房间，其中包含凹房间；这些是该样例的测试值，不代表任意户型的准确率。`public/samples/cpu-recognition.expected.json` 仅用于回归对照，`cpu-preview.obj` 仅用于静态检查。

算法面向清晰、正交、深色实心墙的图纸；门窗样例用红/蓝长条明确标记。家具、尺寸线、双线墙、旋转扫描、曲线、彩色批注及常见未标记门扇都可能误识别。房间名称和层高、窗台等默认值不等同于现场事实。用户须校正墙线、开口、房间轮廓和比例；系统不会从图片推断承重属性或隐藏水电。

部署需另行运行 Python FastAPI 服务；Web/Worker 构建不包含 Python 运行时。启动、环境变量和网络边界见根 README 的“CPU 识别与语义户型原型”章节，以及 `../recognition/README.md`。
