# 何解解题提示词规则登记表

`solver/prompt.txt` 是唯一提示词正文；本表只做索引，不参与请求。  
`prompt.txt` 里的 `<!-- @module:... -->` 决定模块归属，`<!-- @rules:... -->` 列出该段规则 ID；服务端拼请求时会把所有 HTML 注释剥掉，标记不占 token。

## 模块与注入

| 模块 | 内容 | 注入条件 | 预算（字节，去注释） |
|---|---|---|---|
| core | 角色、输出通道、规则优先级、图片题字段 | 始终 | 4200 |
| shared | 坐标轴总表、subQuestions、targets、答案与解析格式 | 始终 | 7200 |
| 2d | renderCode 规范、GGBMath、2D 交互控制 | 2D 或 auto | 7800 |
| 3d | render3d 规范、3D 图元与分步 | 3D 或 auto | 7000 |
| rigor | 定理条件、来源交代、分类讨论、角的范围 | 始终 | 4400 |

| 注入通道 | 组成 | 预算（字节，含 few-shot） |
|---|---|---|
| 2d | core + shared + 2d + rigor + 2D 示例 | 27500 |
| 3d | core + shared + 3d + rigor（不带 2D 示例） | 23500 |
| auto | core + shared + 2d + 3d + rigor + 2D 示例 | 34000 |

检测：`node tools/check_prompt.js`（模块标记、规则登记、预算；失败返回非 0）。

## 规则

| ID | 模块 | 优先级 | 规则摘要 | 验收 | 状态 |
|---|---|---|---|---|---|
| R-CORE-01 | core | P0 | 只输出严格 JSON；二选一通道及公共顶层字段 | static + smoke | active |
| R-CORE-02 | core | P2 | 空间题默认 3D；显式 2D/3D 覆盖通道但不改题目空间 | smoke 2d/3d | active |
| R-CORE-03 | core | P2 | 题目空间、解法坐标、输出通道三件事分开 | smoke | active |
| R-CORE-04 | core | P0 | 冲突让行：P0 安全 > P1 题设 > P2 通道/轴 > P3 可执行 > P4 格式 > P5 风格 | manual | active |
| R-CORE-05 | core | P1 | 图片题先读题干、图形、字母、条件 | image smoke | active |
| R-CORE-06 | core | P4 | 图片题必填 questionText；figureBox 为归一化图形框 | image smoke | active |
| R-AXIS-01 | shared | P2 | 空间题 + 3D：三轴、labels、原点在第一卦限 | smoke 3d | active |
| R-AXIS-02 | shared | P2 | 空间题 + 2D 斜二测：三条 arrow，1.35 倍跨度 | smoke 2d | active |
| R-AXIS-03 | shared | P2 | 平面题 + 2D：建系才画 x/y，纯几何不画 | smoke 2d | active |
| R-AXIS-04 | shared | P2 | 平面题强制 3D：z=0，仍画三轴 | smoke 3d | active |
| R-AXIS-05 | shared | P2 | 三视图/展开图：视图内不画空间轴 | golden G-3V | active |
| R-AXIS-06 | shared | P2 | 独立 2D 截面按平面图处理；嵌在斜二测里仍画三轴 | golden G-XS | active |
| R-SUB-01 | shared | P4 | subQuestions 只能在顶层，不能写进 render3d | static + smoke | active |
| R-SUB-02 | shared | P4 | 小问解析可独立阅读；允许“同理”但须重述关键设定，禁止只指路 | golden G-SUB | active |
| R-TGT-01 | shared | P4 | targets 语义：省略=不动图；公共底图写进每问 | golden G-SUB | active |
| R-STEP-01 | shared | P2 | 除纯选择题外每题必须给分步讲解（≥2 步、每步至少 1 个对象、与 analysis 分段对应） | golden G-STEP | active |
| R-FMT-01 | shared | P4 | 公式必须带 `$...$` 分隔符 | static | active |
| R-FMT-02 | shared | P4 | 多小问/多选项按段拆分，全角段首 | golden G-SUB | active |
| R-FMT-03 | shared | P4 | 关键结论加粗，限 2~12 字、1~3 处 | golden G-FMT | active |
| R-FMT-04 | shared | P5 | 详略服从用户要求 | manual | active |
| R-FMT-05 | shared | P4 | 答案写法：多选 `ACD`、填空 `①…；②…`、证明一句结论 | golden G-FMT | active |
| R-2D-01 | 2d | P3 | renderCode 首行 GGBBoard.init + axis:false | static + smoke 2d | active |
| R-2D-02 | 2d | P3 | board.create 常用图元与 glider/slider | smoke 2d | active |
| R-2D-03 | 2d | P3 | 只用 GGBMath 现有签名，不手写同名函数 | smoke 2d | active |
| R-2D-04 | 2d | P4 | 画布文字用 Unicode，禁止裸 LaTeX 命令 | smoke 2d | active |
| R-2D-05 | 2d | P4 | 角度用 angle 图元标注 | smoke 2d | active |
| R-2D-06 | 2d | P0 | 只允许 GGBBoard/GGBMath/JXG/board/window/Math 全局 | static | active |
| R-2D-07 | 2d | P5 | 变量名用英文，中文只出现在显示文字 | static | active |
| R-2D-08 | 2d | P5 | 动点/参数/范围/轨迹/存在性题要能动；静态题不强制 | golden G-MOVE | active |
| R-2D-09 | 2d | P3 | boundingbox 包住图形并留边距 | smoke 2d | active |
| R-2D-10 | 2d | P3 | 坐标轴 arrow 画法：1.35 倍跨度、颜色固定 | smoke 2d | active |
| R-2D-11 | 2d | P3 | 交互控制引用的对象必须有同名 name | static | active |
| R-2D-12 | 2d | P4 | steps/controls/focusTargets 可选字段语义 | smoke 2d | active |
| R-2D-13 | 2d | P4 | 三视图/展开图多视图排版：长对正/高平齐/宽相等、虚线、无空间轴 | golden G-3V | active |
| R-3D-01 | 3d | P2 | 坐标系 upAxis 与三轴声明；空间/平面 3D 的轴规则 | smoke 3d | active |
| R-3D-02 | 3d | P3 | render3d 字段清单与图元 schema | static + smoke 3d | active |
| R-3D-03 | 3d | P3 | 顶点/棱/面/球/圆柱/动点的建图要点 | smoke 3d | active |
| R-3D-04 | 3d | P4 | 需要显示/高亮的平面才建 id；同一平面只一个 id，子区域用线段 | golden G-PLANE | active |
| R-3D-05 | 3d | P4 | 几何定义法求二面角先求交线并放进该步 elements；向量法不要求 | golden G-DIH | active |
| R-3D-06 | 3d | P3 | 数字/颜色格式，所有 id 唯一 | static | active |
| R-3D-07 | 3d | P3 | render3d 必须是纯 JSON | static | active |
| R-3D-08 | 3d | P4 | 画布标签支持有限 LaTeX；标题公式要包 `$...$` | smoke 3d | active |
| R-3D-09 | 3d | P4 | subQuestions 不写进 render3d | static | active |
| R-3D-10 | 3d | P2 | 球类题：球心定位、外接/内切球半径与答案一致、截面圆 r=√(R²−d²) 与 normal 方向 | golden G-SPH | active |
| R-3D-11 | 3d | P2 | 一题多图：不同小问不同几何体时 questionScenes 装全部场景，顶层只放第一张副本 | golden G11 | active |
| R-3D-12 | 3d | P2 | 棱切球半径取到棱距离；两球按球心距判位置关系；球面距离 R·θ | golden S04/S05 | active |
| R-3D-13 | 3d | P2 | id 命名：点=字母+数字（与 label 一致）、棱 seg_字母序、面 plane_顶点、球 sphere_圆心、圆 circle_圆心、尺寸 dim_两端；禁止英文描述词 | 静态 | active |
| R-RIG-01 | rigor | P1 | 平行/垂直八条判定与性质写全条件，禁止跳步 | golden G-RIG | active |
| R-RIG-02 | rigor | P1 | 长度/坐标/角度要交代来源 | golden G-RIG | active |
| R-RIG-03 | rigor | P1 | 二面角 $[0^\circ,180^\circ]$ vs 两平面夹角 $[0^\circ,90^\circ]$；交线只对几何法强制 | golden G-DIH | active |
| R-RIG-04 | rigor | P1 | 分类/多解/定义域/轨迹完备性检查清单 | golden G-CLASS | active |

## 追问提示词（`solver/chat-prompt.txt`）

面向“何解·追问”的对话，不参与解题 JSON 生成；与主解析共用严谨性口径。

| ID | 规则摘要 | 验收 |
|---|---|---|
| C1 | 引用定理写全条件（线面垂直判定、面面垂直性质需写出交线） | manual |
| C2 | 交代依据来源：题设 / 前一步推出 / 计算结果 | manual |
| C3 | 该分类就分类：点的位置、参数正负、解的数量，多解列全并取舍 | manual |
| C4 | 不用“显然/易得/同理可得”代替关键步骤 | manual |
| C5 | 用户前提与题设矛盾时先纠正再回答 | manual |
