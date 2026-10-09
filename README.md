# Show Me Graph

读一篇技术报告时，一个方法、公式或实验结论常会引出许多引用。逐篇追溯后，论文之间的传承，以及系统、方法、组件和结论之间的关系，往往只留在研究者的脑海里。Show Me Graph 把这些关系整理成可查看的知识图谱，并将判断关联到原文证据；Coding Agent 可以通过 Skill 调查和维护同一份本地知识库。

## 安装

需要 Node.js 20.19+（20.x）或 22.12+、npm 和 Python 3。克隆仓库并启动 WebUI 与本地 API：

```sh
git clone https://github.com/hit-cxf/show-me-graph.git
cd show-me-graph/experiments/prototype
npm ci
npm run build
npm start
```

打开 <http://127.0.0.1:4317>。全新安装会创建空知识库；数据只保存在本机，不随仓库发布。

仓库已为 Codex、Claude Code 和 CodeBuddy Code 配好项目级 Skill 入口。在仓库内新开 Agent 会话即可使用 `show-me-graph`。要在其他项目使用，在仓库根目录安装用户级 Skill：

```sh
python3 scripts/install-skill.py codex
# 或：python3 scripts/install-skill.py claude
# 或：python3 scripts/install-skill.py codebuddy
```

Skill 通过运行中的本地 API 与 WebUI 共享知识库。首次使用可请 Agent“使用 show-me-graph Skill 检查知识库状态”。其他支持 `SKILL.md` 的 Agent 可导入整个 [`skills/show-me-graph`](skills/show-me-graph/SKILL.md) 目录。详细接口与兼容范围见[Skill 说明](docs/AGENT_SKILL.md)。
