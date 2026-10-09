# 开源方案与复用调研

文档研究日期：2026-10-04；实测更新：2026-10-05。**下表保留早期文档调研，运行结论以 [M0 报告](M0_RESULTS.md) 为准。** sift-kg、NodeGraph 已安装并完成局部实测，不能把未覆盖路径视为已验证。

需求修订说明：用户已澄清三维必须是“顶部论文关系图 + 每篇下悬的二维技术关系切面 + 切面间连线”，且支持各切面单独阅读。仅支持层次折叠或普通三维节点图，不足以满足此要求。还需检验从阅读疑问到有证据解释、再到图谱增量的流程；此说明更新评估标准，不代表对下列项目增加了运行验证。

工作流补充：用户主要使用 Zotero，并确认新论文自动收录到用户指定的目录，因此导入与自动收录均为首版优先事项。已核实[官方本地 API](https://www.zotero.org/support/dev/web_api/v3/local_api)并连接本机 10.0.4 读接口。尚待选择实际目标目录，未执行写入。

## 1. 当前结论

**sift-kg 与 NodeGraph 已完成首轮实测，均不宜直接用作主库。** sift-kg 存在版本/缓存、人工修正及证据结构缺口；NodeGraph 的局部树结构与弱引文检查不满足统一图谱要求。目前没有找到经实测完全覆盖需求的单一开源项目；这不是对所有开源项目的穷尽结论。

建议组合成熟组件，自己维护稳定身份、出现位置、断言、证据、修订和 API。PDF.js 与 3d-force-graph 已在真实样本原型中连通；其他候选仍按下表继续评估。

## 2. 最接近的候选

| 项目 | 官方材料已明确的能力 | 与目标的差距或待验证项 | 建议 |
| --- | --- | --- | --- |
| [sift-kg](https://github.com/juanceresa/sift-kg) | 多文档实体/关系抽取；academic 模式含方法、系统、结论、论文等类型和 EXTENDS/IMPLEMENTS 等关系；本地数据、片段溯源、增量处理、CLI、Agent Skill、交互图。 | PDF 段落坐标高亮、完整备注/标签维护 API、修订与证据状态、论文平面+成果纵深尚未核实。 | 优先测试作为抽取与图谱内核。代码 [MIT](https://github.com/juanceresa/sift-kg/blob/main/LICENSE)。 |
| [NodeGraph](https://github.com/Jeong-jin-Han/NodeGraph) | Agent 规范驱动 JSON 图；二维层次画布、跨图链接、原文引用回跳 PDF 并高亮、引文验证器、交互 HTML 导出。 | 以 VS Code 画布为主；领域级多论文身份管理、独立服务 API、三维布局尚未核实。跨图链接不等于统一实体库。 | 优先测试阅读、证据验证与编辑体验。代码 [MIT](https://github.com/Jeong-jin-Han/NodeGraph/blob/main/LICENSE)。 |
| [google-surf-mcp](https://github.com/HarimxChoi/google-surf-mcp) | 项目本地知识库、搜索与论文抓取、MCP、类型关系及来源链、修订、图检索与 HTML 导出；仓库标注 MIT。 | 科研继承词表、PDF 坐标回跳、所有维护操作的接口覆盖，以及指定三维层次尚未核实。浏览器检索链路还需验证稳定性。 | 作为第三候选，主要评估 Agent 入口、增量存储与来源记录。 |

NodeGraph 示例工作流会为布局设置分支数与层次规则。复用时应把展示分组与真实的科学实体分开；不能为了画面整齐而生成没有依据的“方法组件”。其引文验证器能帮助检查引文存在，但原文包含一句话仍不足以证明 AI 给出的关系解释正确。[官方 README](https://github.com/Jeong-jin-Han/NodeGraph)

## 3. 文献管理与学术知识基础设施

| 项目 | 可以复用或借鉴的部分 | 尚未覆盖或尚未证实的部分 |
| --- | --- | --- |
| [Zotero](https://www.zotero.org/support/collections_and_tags) | 文献、附件、集合、标签；[PDF 阅读与批注](https://www.zotero.org/support/pdf_reader)可作为现有工作流入口。 | 这些官方文档未给出本项目所需的成果关系图。接入前须按安装版本核对 [Local API](https://www.zotero.org/support/dev/web_api/v3/local_api) 的读写能力，不能假定所有版本均支持相同写操作。 |
| [Paperlib](https://github.com/Future-Scholars/paperlib) | 文献元数据、全文搜索、过滤、标签/目录/备注，以及扩展机制。 | README 未证实贡献级图谱、关系证据锚点与指定三维视图；扩展 API 与独立外部 API 要分别评估。 |
| [ORKG](https://academy.orkg.org/courses/paper-course.html) | 论文、贡献、属性与模板建模，适合借鉴结构化研究比较；提供 [REST API](https://tibhannover.gitlab.io/orkg/orkg-backend/index.html)。 | 尚未确认符合本地 PDF 归档与段落回跳需求；[后端部署配置](https://github.com/TIBHannover/orkg-backend/blob/master/compose.yaml)提示需要评估单人安装与运维成本。 |
| [Open Knowledge Maps / Headstart](https://github.com/OpenKnowledgeMaps/Headstart) | 领域知识地图与网页可视化。 | 官方材料未证实成果级继承、原文定位、本地库完整维护和指定三维层次。 |

许可登记：Zotero 源码为 [AGPLv3](https://raw.githubusercontent.com/zotero/zotero/main/COPYING)，Paperlib 仓库标注 GPL-3.0，ORKG [后端为 MIT](https://github.com/TIBHannover/orkg-backend/blob/master/LICENSE)，Headstart 仓库标注 MIT。代码复用、进程间集成与数据导入是不同工程路线；最终选型应锁定版本并登记实际使用的组件。

这里优先核实有明确源码入口的项目。常见文献发现产品即使交互有参考价值，也不能仅凭能访问网页就认定开源、可本地部署或可作为底座。

## 4. 成熟组件：适合直接复用的能力

| 能力 | 候选与官方依据 | 本项目需要补齐 |
| --- | --- | --- |
| 学术 PDF 结构解析 | [GROBID](https://github.com/grobidOrg/grobid)，代码 Apache-2.0；[坐标文档](https://grobid.readthedocs.io/en/latest/Coordinates-in-PDF/)支持段落/句子等的页码与 bbox。 | 固定文件版本、段落身份、证据状态；解析位置存在不代表科学关系正确。 |
| 通用文档解析备选 | [Docling](https://github.com/docling-project/docling)，代码 MIT；[数据模型](https://docling-project.github.io/docling/reference/docling_document/)包含页码、bbox、charspan。 | 比较双栏、公式和表格表现；模型许可单独核查；主解析器与回退方案不应无条件重复运行。 |
| 本地 PDF 阅读 | [PDF.js](https://mozilla.github.io/pdf.js/)，Apache-2.0；[示例 API](https://mozilla.github.io/pdf.js/examples/)。 | 稳定 evidence_id、坐标转换、跨页高亮、失效检测；普通页码链接不够。 |
| 三维图渲染 | [3d-force-graph](https://github.com/vasturiano/3d-force-graph)，MIT。 | 自定义论文 `z=0`、成果纵深、跨论文边、稳定位置及共享实体展示；默认力导向不自带这些语义。 |
| 二维图与编辑 | [Cytoscape.js](https://js.cytoscape.org/)，MIT。 | 与三维视图统一身份、筛选及布局；使用两个库的额外复杂度需实测评估。 |
| 文献元数据与扩展 | [OpenAlex API](https://help.openalex.org/api/)及[引用扩展示例](https://help.openalex.org/how-to/api-recipes/)，数据 CC0；[Semantic Scholar API](https://webflow.semanticscholar.org/product/api)是备选。 | 保存查询来源、日期、预算、版本与纳入理由；API 凭证、限额和数据使用条件在接入时检查。S2 使用[专门协议](https://api.semanticscholar.org/license/)，不是通用开源代码许可。 |

## 5. LightRAG / GraphRAG 的适用边界

[LightRAG](https://github.com/HKUDS/LightRAG) 已提供图相关检索、WebUI、REST API、引用和文档处理集成；可以评估为抽取或检索组件。其存在不意味着科研关系的类型、证据支撑和版本修订需求已满足。代码 [MIT](https://github.com/HKUDS/LightRAG/blob/main/LICENSE)。

[Microsoft GraphRAG](https://github.com/microsoft/graphrag) 的[关系输出](https://microsoft.github.io/graphrag/index/outputs/)可以关联文本单元，也支持接入已有图。文本块来源有助于溯源，但仍需项目自己的段落锚点、关系词表和核验规则。代码 [MIT](https://github.com/microsoft/graphrag/blob/main/LICENSE)。

建议将它们视为可替换的候选生成与检索层。权威记录仍应是带稳定身份、原文证据、限定条件和修订历史的结构化数据。是否引入，应在基础闭环已经能够准确打开原文后决定。

## 6. M0：避免重复造轮子的决策实验

使用 [图像生成试点](PILOT_IMAGE_GENERATION.md) 的同一批样本，而非每个项目各用一个最容易成功的演示文件。先测试 sift-kg 和 NodeGraph；若 Agent 来源记录是主要缺口，再测 google-surf-mcp。解析器比较与此并行。

每个候选执行以下任务，报告成功、需少量适配、需结构性修改或失败，并保留版本/commit 与操作记录：

| 测试 | 核心观察 |
| --- | --- |
| 导入约 10 篇文献 | 元数据、版本、全文与失败状态能否持久保存和导出。 |
| Zotero 工作流 | 选择性导入、增量变化、多附件、返回原条目及新论文自动收录到指定目录；验证去重、失败重试和附件状态，不能仅凭 BibTeX 导入认定完整接入。 |
| 同方法多次出现 | 能否复用一个身份，避免把名称相同、版本不同的方法错误合并。 |
| 同一对论文存在多种关系 | 是否能区别引用、采用组件、继承以及比较。 |
| 点击组件和关系 | 是否精确打开对应版本 PDF 的原文片段；关系是否也能有独立证据。 |
| AI 自动入主图 | 未审内容可见，同时可按依据和证据状态筛选；是否需要改造存储模型。 |
| 人工改错后重跑 | 是否保留修正，是否能看到冲突，而非回到旧错误。 |
| 标签/备注/分组/视图 | 能否分别通过界面和程序维护；不得只演示只读查询。 |
| 三维语义 | 顶部论文图、每篇下悬的完整二维技术图、共享实体与跨切面边；三维和各类切面能否切换，是否保留孤立节点。 |
| 阅读疑问闭环 | 一个术语或表格问题能否获得带来源的解释，并将必要调研沉淀为可复用增量；可否区分未调查与证据不足。 |
| 迁移与恢复 | 导出后能否在另一路径恢复实体身份与本地证据关联。 |

采用规则：

1. **直接采用：** 必需闭环可完成，只需配置、Skill 或小型适配；三维等关键需求也有可接受实现路径。
2. **扩展现有底座：** 数据模型能够无损表达证据与多关系，接口可扩展，主要工作集中在 UI 或连接器。
3. **组合实现：** 各候选只覆盖局部，统一身份和证据无法可靠打通；复用解析器与渲染器，自己实现缺失核心。

阶段产出为一份决策记录：每项需求的证据、改造范围、依赖风险、安装负担、粗略工作量，以及为什么选择某一路线。资料初筛不能代替这个实验。
