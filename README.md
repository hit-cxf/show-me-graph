# Show Me Graph 1.0

面向科研调研的本地知识图谱：把论文、概念、方法、系统、组件和研究结论组织成可追溯、可维护的网络。三维空间包含顶部论文图、每篇论文下悬的二维技术图及跨图关系；允许 Coding Agent 通过 Skill 和程序接口解释阅读疑问并增量维护知识库。

WebUI、可写 API 与 Agent Skill 使用同一份本地知识库。**GitHub 仓库只发布程序、Skill 和文档。** 论文 PDF、题录、实体、关系、证据、个人偏好和运行数据均留在本机，不进入 Git。全新克隆首次启动创建空知识库；已有本地库保持原样。

- [Agent Skill 安装与使用](docs/AGENT_SKILL.md)：标准 Skill 包、Python 客户端、各宿主验证范围。
- [共享知识库 API](experiments/prototype/API.md)：记录维护、版本控制、批量事务与实时同步。
- [项目任务书 v0.7](docs/TASKBOOK.md)：Zotero 导入与自动收录、极速/深度模式、数据模型、三维交互、接口与验收。
- [M1 共享知识库实测](docs/M1_RESULTS.md)：报告覆盖、双向同步与测试范围。
- [M0 实测与复用决策](docs/M0_RESULTS.md)：真实运行结果、原型入口、复现方式与尚未完成项。
- [开源方案与复用调研](docs/REUSE_RESEARCH.md)：官方资料核实结果、缺口与实测清单。
- [图像生成试点](docs/PILOT_IMAGE_GENERATION.md)：以 Qwen-Image-2.0 技术报告为锚点的首轮验证方案。

已确认的产品选择：极速模式问到哪查到哪，深度模式主动展开完整调查，两者共用知识库；AI 抽取结果自动进入主图并展示推断、证据与核验状态；三维总览、论文横切面、单篇技术纵切面及跨论文技术切面均为必要能力；第一批试点为图像生成。

1.0 发布当前可运行的本地软件。任务书中的完整功能与验收指标仍是开发目标；已实现功能见[原型说明](experiments/prototype/README.md)；M0 报告保留为历史实测记录。

Zotero 导入与自动收录是后续目标，目前提供本地 API 和 Skill 供 Agent 维护知识库。

## 运行共享知识库

```sh
cd experiments/prototype
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:4317>。`npm start` 在后台运行，`npm run status` 查看状态，`npm stop` 停止。全新克隆显示空知识库；通过 [API](experiments/prototype/API.md) 或 Skill 导入自己的数据后即可在网页查看和维护。三维图左键平移、右键旋转、滚轮缩放，左下角图例可收起。数据保存在被 Git 忽略的 `experiments/prototype/.runtime/`。

运行 `npm test` 可检查布局与导航。依赖本地研究语料的集成测试在语料不存在时跳过。自动调查调度、通用 PDF 抽取和 Zotero 自动写入尚未实现。
