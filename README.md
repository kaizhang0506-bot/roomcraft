# 筑境 Roomcraft

面向室内设计师的本地工作台。React19 / Vinext / Three.js，集成 Pascal Editor 1.1.4（MIT）。

## 已接入

- 图片/PDF/DXF/项目JSON导入；CPU 几何识别与真实视觉模型识别，可手工校正墙体、门窗、房间多边形、比例与层高。
- 样例图片实际送入 FastAPI 识别，输出米制 schemaVersion 2；OBJ/GLB 不作为编辑数据。
- 真实AI家具布置，保留墙体；二维家具、节点、墙体和水电线路编辑。
- 墙体/线路可点击选择和删除，支持可见删除按钮、Delete/Backspace、撤销；删墙同时清理关联门窗。
- 二维/三维共用米制空间数据，支持凹形地板、鸟瞰/俯视/斜视、房间导航、12种可编辑材质和水电图层同步。
- 实时三维采用真实 GLB 沙发与座椅、PBR 颜色/法线/粗糙度贴图、HDR 环境光、柔和阴影及 GTAO；三维界面可请求独立路径追踪静帧（需要支持 WebGL2 浮点渲染）。
- 全景预览可载入 AI 样图、上传 2:1 全景或为房间生成全景：只能定点环顾及切换房间，全景不代表连续自由行走或实际房屋照片。
- 项目自动本机保存、JSON 完整导入导出，以及携带可编辑数据的压缩分享链接；本地 URL 仅本机可访问。
- 第一人称漫游：WASD/方向键、拖动看向、可选锁定鼠标、手机虚拟摇杆与方向键、房间切换与安全点重置。正常门洞可通过，墙、窗洞、家具和边界有基本碰撞；Esc退出并恢复原视角。
- 真实 GPT Image2 生图与参考图编辑：提交异步任务、断线/停止后继续等待、自动取回图片，IndexedDB保留最近4张；支持下载和刷新恢复。
- Pascal专业场景独立建模/保存/JSON导入导出；主工作台项目JSON与CAD设计草稿导出。
- 三维空间右侧「家具材质」支持选择房间并一键添加家具，或应用地面、墙面与家具材质；家具可拖动、撤销和保存。矮凳、吧椅目前沿用简化座椅模型。
- 三维「日照与朝向」支持日出、上午、正午、日落、夜晚预设与时间/户型正北方向调整，指南针随视角旋转。这是视觉效果模拟，不使用地理位置、日期或季节，不可作为专业日照分析；该预览设置暂不保存在项目中。
- 三维画质默认「流畅模式」，降低实时阴影、光源和后处理开销；可切换「精细模式」恢复更丰富的实时光影。画质设置保存在浏览器；在可检测到软件渲染时显示硬件加速提示。独立静帧光追不由该选项替代。
- 可选 MeltFlex 照片转漫游：需要在服务器设置单独的 `MELTFLEX_API_KEY` 和有效订阅，草稿官方标价 30 credits；用户主动确认后才提交。输出是第三方托管的高斯泼溅空间，生成结果尚未实测，家具不能作为独立设计对象移动。提交或网络结果不明时应先检查服务商任务历史，不应自动重复付费提交。服务端使用固定上游地址及绑定用户的任务凭据；本地进程中的去重不会跨重启或多实例持久化。

## 运行与配置

Node.js24+、npm。`npm ci`，将 `.env.example` 中的字段填入忽略提交的 `.dev.vars`，再运行 `npm run dev`。生产构建 `npm run build`。本机检查生产产物可运行 `npm run start -- --env-file .dev.vars`，显式加载根目录环境文件；远程部署应使用宿主平台的服务端环境绑定。真实密钥只在服务端配置，源码包不含密钥。

生图变量：IMAGE_API_KEY、IMAGE_BASE_URL、IMAGE_MODEL、IMAGE_PROTOCOL。
当前服务为 Conflux兼容接口的 gpt-image-2，协议 conflux_async；不是把聊天内置工具直接当成网站后台。
识别与布置：CONFLUX_API_KEY、CONFLUX_BASE_URL、VISION_MODEL。
若改用OpenAI官方接口，设置 IMAGE_PROTOCOL=openai、IMAGE_BASE_URL=https://api.openai.com/v1 和自己的生图密钥。

## 接口

- GET /api/status：配置状态和模型名，不返回密钥。
- POST /api/analyze：{image:dataURL} → {plan,warnings}。
- POST /api/design：{plan,style,prompt} → {plan,summary,model}；只更新家具。
- POST /api/generate：{plan,style,roomId?,prompt?,referenceImage?} → 202 {taskId,taskToken,status,model}，或官方同步协议直接返回图片。
- GET /api/generate?taskId=...：请求头 X-Roomcraft-Task-Token，返回 processing 或 succeeded+图片。任务凭据以HMAC绑定用户，有效期24小时，不放URL。

停止等待不会取消供应商后台任务。客户端不自动重复提交；保存的任务可继续查询。模型失败保留原方案和已有图。已兼容实际遇到的网关状态异常：仅在精确错误结构及已知结果主机下取回真实、通过图片类型/大小检查的文件，不把错误文本当图片。

供应商官方文档：https://oapi.kaitools.cn/docs?p=gpt-image-系列模型使用说明

## 验证

- 全量 TypeScript 与生产构建；生产预览的真实 CPU 样例接口返回 200。
- 27 项语义协议、像素单位转换、凹形边界、分享压缩/限额与真实识别链路检查；Python 识别服务 10 项测试。
- 新增 10 项多边形/材质/门槛/扩展范围几何回归，以及 12 项实际浏览器检查。
- 23项图纸/JSON读写检查。
- 17项漫游碰撞/出生点测试、11项实际浏览器漫游测试：W实际位移、门洞、焦点、退出恢复等。
- 墙、电路、水路的选择、删除、撤销及3D联动通过浏览器验证。
- 12项异步任务归属/过期/失败/下载回归，以及7项异步UI恢复/存储验证。
- 图片/PDF上传、家具拖动持久化、JSON/DXF实际下载、手机布局验证。
- 真实示例户型识别6房9墙7门窗；AI布置15件家具，墙体保持不变。
- 真实网页按钮→第一人称参考图→异步图生图→取回图片→IndexedDB保存→刷新恢复通过，仅1次POST；这些结果仅适用于本次样例，不代表通用准确率或延迟保证。

## 当前边界

导出的水电与CAD图仍为设计草稿，不是完整装修施工图，不提供电气负荷计算、结构安全判断或施工合规确认。识别结果与现场尺寸必须由设计师核对。

房间多边形决定地板、面积和室内可通行范围；兼容矩形是派生包围盒。改墙不自动重算房间边界。PDF目前只读取第一页。DWG需先另存DXF；外部块/曲线不自动重建。DXF往返保留墙体，完整项目用JSON恢复。

Pascal专业场景与主户型尚未双向同步，其资源由上游资源服务加载。本机浏览器存储尚未接入团队云端项目管理。清除浏览器数据前请导出项目和生成图片。

## 图像与开源来源

public/images/living-room.png 为本会话内置ImageGen真实生成的灵感示例；提示词见 docs/image-assets.md。
public/images/relay-verified.png 为已实测GPT Image2接口生成的示例。
outputs/roomcraft-firstperson-render.png 是从网站第一人称参考视角实际生成的验证图片。

Pascal：https://github.com/pascalorg/editor（MIT）
Three.js：https://github.com/mrdoob/three.js（MIT）
PDF.js：https://github.com/mozilla/pdf.js（Apache-2.0）
dxf-parser：https://github.com/gdsestimating/dxf-parser（MIT）
保留上游许可证；未引入CubiCasa5K非商用数据/模型。

## CPU 识别与语义户型原型

不需要模型密钥的真实运行路线：原创样例图片 → 本地 CPU 几何识别 → 米制 schemaVersion 2 → 二维校正与三维漫游。它是清晰正交图纸的最小原型，使用传统几何算法，未训练或下载分割模型，不使用 CubiCasa5K 数据/权重。已有视觉模型和生图配置可继续单独使用。

从项目根目录在一个 PowerShell 窗口启动 Python 服务（Python 3.12+，本机以 3.14 验证）：

```powershell
python -m venv recognition/.venv
recognition/.venv/Scripts/python.exe -m pip install -r recognition/requirements.txt
recognition/.venv/Scripts/python.exe -m uvicorn recognition.app:app --host 127.0.0.1 --port 8001
```

在已忽略提交的 `.dev.vars` 中新增 `RECOGNITION_SERVICE_URL=http://127.0.0.1:8001`，然后在另一个窗口运行已有的 `npm run dev`。如果 Web 服务已经运行，修改环境变量后重启它。macOS/Linux 将 Python 路径换为 `recognition/.venv/bin/python`。CPU 路线不依赖生图或视觉模型密钥；生图继续走上文独立的服务端 API 配置。

- `GET http://127.0.0.1:8001/health` 检查 CPU 服务。
- `GET /api/recognize/sample` 实际获取 Python `/sample` 的 PNG 和参考宽度，再 POST `/recognize`，经过校准、语义转换和验证后返回 `{plan,warnings,provider,sourceImage}`。
- `POST /api/recognize` 接收 `{image:dataURL, provider:"cpu", knownWidthMeters?:number, name?:string}`；图片限 PNG/JPG/WEBP、6 MB。参考宽度指外墙轴线 X 方向总跨度，单位米。
- `provider:"vision"` 使用原有视觉模型；未指定提供方时，有 `RECOGNITION_SERVICE_URL` 即选择 CPU，否则选择视觉模型。两条路线都要求人工校正。

根目录可运行 `recognition/.venv/Scripts/python.exe -m unittest recognition.test_service -v` 验证服务；`recognition/.venv/Scripts/python.exe -m recognition.export_sample` 可重新生成原创样图和回归对照。样例实测提取 7 段墙、4 个开口、3 个房间，保留 L 形轮廓。`public/samples/cpu-recognition.expected.json` 只用于测试，网页没有用它替代识别请求。

房间边界以 `polygon` 为准，矩形字段是兼容包围盒。墙、开口和房间多边形是编辑依据，OBJ/GLB 只可作派生预览。编辑器所有长度使用米；CPU 响应中的平面坐标、墙厚、开口宽先使用 working image 像素，经 `metersPerPixel` 与墙轴线原点转换。`imageTransform` 记录该映射，层高、墙高、窗高和窗台高从服务起即为米。完整规则见 [语义协议](docs/semantic-schema.md)。

CPU 原型不能保证识别普通装修图的全部符号。样例用红色长条标门、蓝色长条标窗；家具、尺寸线、曲墙、斜墙、双线墙或扫描倾斜可能造成遗漏与误判。房间名称、比例和垂直尺寸仍需核对；移动墙不会自动推断完整房间拓扑。结果始终标为待校正，不会根据图片捏造水电、承重属性或施工结论。

部署时必须将 Python 服务作为独立进程/容器运行，并将 `RECOGNITION_SERVICE_URL` 指向 Web 服务可访问的地址。Web/Cloudflare Worker 包不会启动 Python；远程 Web 服务也无法访问开发电脑的 `127.0.0.1`。当前 CPU 接口没有用户鉴权，原型绑定本机回环地址；正式部署需在受控内部网络或有鉴权的网关后接入。共享服务器、账号权限及云端持久存储仍需另行实现。

服务协议、限额、依赖与许可清单见 [recognition/README.md](recognition/README.md) 和 [参考仓库审查](docs/reference-audit.md)。

语义协议与分享回归：`npm run test:schema`；本机服务运行时 `node scripts/test-layout-schema.mjs --live` 实际识别样图。源码交付可用 `python scripts/package-source.py` 生成，自动排除密钥、构建、node_modules 和 Python 虚拟环境，并检查本机密钥没有进入源码及浏览器构建。

## 写实单间演示与素材

点击「写实单间样例」：原创 PNG 发送到 CPU 识别服务，识别墙段、门窗和房间后在同一语义项目中布置家具；在「三维空间」点击「进入漫游」，WASD 或移动端摇杆可移动，拖动画面看向。实时画面是 PBR 渲染，照片级程度依场景素材和设备而异，并不等同于 AI 效果图。需要更高质量静帧时点击「光线追踪出图」；不支持的 GPU 将明确提示，不会把普通截图标成光追。

「New Era 光追」是另一条可选的本机静帧路线：设置服务端 `NEWERA_RENDER_SERVICE_URL=http://127.0.0.1:8002`，并从项目根目录运行 `powershell -NoProfile -ExecutionPolicy Bypass -File recognition/start-newera-bridge.ps1`。脚本默认查找相邻 `newera-test/app/3D New Era AI/newera.exe`；可通过 `NEWERA_EXECUTABLE` 指向已安装的官方程序。每次出图启动独立的 New Era 进程，不修改已打开的 New Era 项目。墙、房间与门窗来自提交时的户型，家具和材质会近似转换，水电不参与出图；输出是静态 PNG，不是可自由移动的照片级场景。渲染期间修改的方案不会被旧结果覆盖。

贴图与 HDR 来自 Poly Haven CC0；家具模型的来源、作者、许可及修改记录见 [素材许可](public/assets/realistic/NOTICE.txt)。沙发含 CC BY 4.0 内容，应保留署名。光追采用 MIT 许可的 three-gpu-pathtracer，需保留相应依赖许可证。生成的全景示例与提示词记录见 [图像生成记录](docs/image-assets.md)。

## 设计能力入口与技能任务

左侧星形「设计能力」或画布下方「设计能力与技能」打开统一面板。设计流程中的按钮实际进入上传、House 识别、几何校正、家具、材质、三维/光追、全景、效果图、Pascal 和导出功能。模块按需加载，不同时启动多套编辑器。

「AI 设计助理」使用已配置的设计模型生成全屋家具方案，先预览摘要和家具，再点击应用；只更新家具，墙、门窗、房间和水电保留，应用后支持撤销。项目在生成期间变化时拒绝应用旧方案。它使用现有 `/api/design`，不是在浏览器直接运行外部 Skill 脚本。

同一面板可以复制/下载 House Plan Designer、ArchLang 和 Interior Design Expert 的 Codex 任务。任务携带当前经过验证的米制项目和用户需求，**不含原始图片、生成图片和服务配置**；把任务交给 Codex 执行，修改后的 `.roomcraft.json` 再从「打开设计资料」导入。技能安装在本机 Agent 目录，不随网站部署自动复制到服务器。ArchLang 只用于独立的新户型方案；未接通浏览器中的 CLI 执行。安装位置与依赖见 [技能安装报告](../refs/设计技能安装报告.md)。

「技能与接入状态」区分代码集成、Codex 任务、待配置服务与仅作参考的项目。`GET /api/capabilities` 查询本地识别/绘图/渲染服务，远程模型只报告配置是否存在，不发送付费生成请求、不返回密钥。

### 本地组件服务

Windows 下安装 Python 依赖和 New Era 程序后，可在项目根目录启动/检查两个独立服务：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local-services.ps1
```

脚本保持已运行的本项目服务，只启动缺失服务；若端口被其他进程占用则报错，不关闭它。支持 `-RecognitionOnly`、`-NewEraOnly`、`-NewEraExecutable <官方程序路径>`；日志写入 `.sites-runtime/`。Web 服务另用 `npm run dev`。不要把这些本机回环地址直接用于远程部署。

- **House 识别**：`POST /api/recognize` 的 `provider:"house"` 调用相邻 `refs/core/house-plan-designer/scripts/analyze.py`，候选墙/门窗转换为当前语义 schema，房间待手动校正。可用 `HOUSE_PLAN_DESIGNER_DIR` 配置官方源码路径（指向仓库目录），`HOUSE_PLAN_PYTHON` 配置已安装 numpy/Pillow/OpenCV 的独立解释器。当前本机兼容环境与 WPS 附带的 Python 3.12 有关联，换机应重新创建独立 Python 环境，不能假定可直接复制。
- **Roomsmith**：`POST /api/roomsmith-drawing` 接收 `{plan,roomId}`，实际调用 `refs/ai/roomsmith/engine/room.py` 与 `drawings.py`，返回 `{svg,warnings}`。相邻源码可由 `ROOMSMITH_SOURCE_DIR` 替换。网页在导出面板下载单房间尺寸草图，无法精确表达的旋转家具等会提示；它不是施工交付图，也没有启动 Roomsmith 全套多 Agent 服务。
- **全景**：Photo Sphere Viewer 为默认有 WebGL 的播放器；降级路径保留无 WebGL 环顾。图片投影需为 2:1 等距柱状全景；节点环顾不等于任意位置自由行走。
- **效果图**：支持整图拖动、缩放、重置、下载和返回可编辑三维。此操作没有把图片中的沙发变成三维家具。

### 可选照片漫游服务

`MELTFLEX_API_KEY` 仅配置在服务器；MeltFlex 订阅和额度与现有图像中转站独立。效果图中的「生成漫游空间」先说明图片将发给外部服务及 30 credits 的草稿费用，由用户显式点击提交；本次只验证接口适配和模拟任务流程，**未执行付费生成，也未验证实际生成质量**。

`POST /api/world` 使用受控服务器地址和当前图片，任务 token 绑定用户；结果只接受官方 `marble.worldlabs.ai/world/` 查看链接。刷新/网络中断不自动重复 POST，未知提交需到供应商核对再重试。单进程去重不是生产级持久任务队列；多实例部署前仍需补充持久幂等记录。

该服务生成近似的 Gaussian splat 空间，当前以官方查看链接打开，不能逐件编辑其中家具，也不保证与原户型尺寸一致。没有 API key 时入口明确显示待配置。

Pascal Studio 的托管图片/视频、双向 Pascal 数据同步、同一浏览器场景的 MCP 编辑、施工合规自动判定尚未完成；不能用仓库已克隆来代表这些功能已可用。重复的 Pannellum 和 floorplan-3d 保留参考，当前不再嵌入第二套相同功能。

Pascal 专业编辑已验证实际显示导入的墙、门窗、地面和阴影，导入时保留旧场景备份。浏览器兼容层分别处理 Pascal 的 Zod 4 与主项目 Zod 3，并共享 Three 的 TSL/WebGPU 模块；保留上游正常后处理，避免简化渲染通路用天空覆盖模型。工具栏图标来自官方仓库，位于 `public/icons`，随附 MIT LICENSE。这个结果是可编辑的建筑结构场景，尚未转换原项目的家具、材质和水电，也不是照片级成片。

本轮新增检查：`node scripts/test-design-capabilities.mjs` 验证草稿只更新家具、过期草稿拒绝、任务文件数据边界；`node scripts/test-meltflex-world.mjs` 为不触发扣费的接口测试；`recognition/.venv/Scripts/python.exe -m unittest recognition.test_house_adapter recognition.test_roomsmith_adapter -v` 验证真实本地识别/绘图适配。浏览器交互脚本在 `.sites-runtime/test-capabilities-ui.cjs`（设计模型模拟响应）和既有全景/效果图回归中。

## 多层建筑、室外环境与交互

在「三维空间」或 AI 效果的「可编辑三维」中打开「楼层」：总层数可设为 1–50，每层高度 2–12 米且不低于现有墙体/天花。选择第 10 层或拖动「楼层剖切」滑杆，即隐藏上方楼层，显示可编辑的第 10 层装修。可切换「整栋外观」「楼层剖切」「只看本层」；整栋外观支持点击可见楼层进入。左侧「装修楼层」也能在二维编辑时切换楼层。

各层墙体、门窗、房间、家具、水电及开关状态独立保存；首次进入未编辑楼层会复制当时的户型。减少层数只归档高层数据，再增加可恢复。当前层是主 Plan，其他已编辑层以无递归快照保存在 `building.floors` 中；完整 JSON、浏览器保存、撤销与项目分享都携带这些数据。DXF、单次效果图和专业编辑器导入仍针对当前层。其他楼层采用实例化建筑轮廓，不同时加载 50 套精细家具；没有楼梯、电梯或跨楼层连续行走模拟。

「日照与朝向」支持模拟日期、地点、时区、正北方向、时间、日出/日落、昼夜播放及手动晴天/多云/雨天。天空中的太阳与月亮、照明方向、夜间室内灯光联动；可选庭院或城市窗景。所在楼层越高，窗外地面越低。景观是原创程序生成的示意环境，月亮为近似天文模型，天气不是实时天气，不能当作精确日照/照度报告。

「交互开关」集中控制门窗和房间灯。也可点击实际门扇、窗扇、墙上开关或灯具；漫游时靠近门窗按 **E** 开关。房门有铰链动画，关门阻挡通行，站在门口时会提示先离开再关门；窗户开合不会允许穿越。灯光可按房间覆盖自动昼夜模式，再用「全部灯光恢复随环境」还原。家具继续支持选择、拖动和材料修改；柜门抽屉及电器运行暂未模拟。

「光线追踪出图」会冻结当前三维、门窗姿态、照明、天空与景观；实例化建筑/树木只在静帧快照中展开。星点、雨丝和实时雾不进入光追静帧，昼夜播放时先暂停再出图。New Era 仅转换当前层室内数据，窗外环境和单独开关状态尚未同步到该独立引擎。实时预览仍是可编辑 PBR 场景，不宣称与 AI 生成照片完全一致。

相关回归：`node scripts/test-environment-building.mjs`、`node scripts/test-walkthrough.mjs`、`node scripts/test-pathtracing-snapshot.mjs`。实际浏览器脚本位于 `.sites-runtime/test-environment-building.cjs`、`.sites-runtime/test-environment-browser.cjs` 与 `.sites-runtime/test-scene-interactions.cjs`、`.sites-runtime/test-walkthrough-interactions.cjs`，运行在隔离的本地浏览器会话，不覆盖用户正在编辑的项目。
