# Show Me Graph Agent Skill

可复用包位于 [`../skills/show-me-graph`](../skills/show-me-graph/SKILL.md)。它通过同一个本地 HTTP 服务读取/修改网页所用的知识库；`scripts/smg.py` 只依赖 Python 3 标准库，不要求某个 Agent 厂商的专有工具。

## 安装

本项目已建立三个项目级目录链接，分别供 Codex、Claude Code 和 CodeBuddy Code 发现，均指向同一个规范包。在仓库内启动新的 Agent 会话即可使用。要在其他项目调用本机服务，在仓库根目录运行对应的用户级安装命令（复制完整 Skill 包，包含 `scripts/` 与 `references/`）：

```sh
python3 scripts/install-skill.py codex
python3 scripts/install-skill.py claude
python3 scripts/install-skill.py codebuddy
```

若只想安装到另一个项目，可以运行 `python3 scripts/install-skill.py codex --project /path/to/project`（将 `codex` 换成目标 Agent）。安装器不会覆盖已有同名 Skill；更新复制版时先自行移走旧目录再重新安装。原仓库的项目级目录链接仍在 `.agents/skills/`、`.claude/skills/` 和 `.codebuddy/skills/`。

- Codex：项目级目录为 `.agents/skills/<name>/SKILL.md`；也可放在用户级 `~/.agents/skills/`。[Codex 官方说明](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)
- Claude Code：项目级目录为 `.claude/skills/<name>/SKILL.md`；也可放在 `~/.claude/skills/`。[Claude Code 官方说明](https://code.claude.com/docs/en/skills#where-skills-live)
- CodeBuddy Code（与 WorkBuddy 相关的编程客户端）：项目级目录为 `.codebuddy/skills/<name>/SKILL.md`；也可放在 `~/.codebuddy/skills/`。[官方说明](https://www.workbuddy.ai/docs/zh/cli/skills)
- Tencent WorkBuddy 桌面客户端提供自定义 Skill 和技能管理入口；此处保留标准包供其导入。该客户端在本机未安装，尚不能声称已实测其导入路径或本地服务连接。[WorkBuddy 官方自定义 Skill 指南](https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Practice-Cases/Create-Skills)

项目级链接在支持符号链接的环境中可直接使用；不支持符号链接时用上述安装器复制 Skill。新建 Agent 会话后可明确说“使用 show-me-graph Skill 调查这篇论文”。运行中的 Agent 若没有重新扫描 Skill 目录，需要开启新会话。不要把同名 Skill 安装在多个位置后假定内容会合并。

更新项目内的规范包后，符号链接安装会读取同一份内容；通过复制或导入安装的客户端需要重新复制或导入整个包。已有会话若缓存了旧版 Skill，请重新加载 Skill 或开启新会话，才能使用新增的偏好流程。

## 服务和验证

先启动项目服务：

```sh
cd experiments/prototype
npm start
```

从安装了 Skill 的客户端所在机器测试：

```sh
python3 skills/show-me-graph/scripts/smg.py health
python3 skills/show-me-graph/scripts/smg.py snapshot
python3 skills/show-me-graph/scripts/smg.py get-preferences
python3 skills/show-me-graph/scripts/smg.py list entities
```

`health` 必须显示可写服务，才能做编辑。`snapshot` 返回统一修订号和实体、证据、备注、标签、分组、选择状态与维护偏好。可再通过 WebUI 修改一条备注/标签并重读 API，或通过 API 创建后检查 WebUI，验证双向同步。CLI 的写入示例和错误恢复见 [API 参考](../skills/show-me-graph/references/api.md)。服务只监听 `127.0.0.1`；云端 Agent 或其他电脑不能仅凭 Skill 文件访问用户本机知识库，需要另行建立受控连接，不能把无法连接说成同步成功。

## 用户维护偏好

网页顶部“偏好设置”保存当前知识库共用的提示词，例如检索重点、论文取舍、抽取粒度、备注语言或记录格式。它存储在服务端的 `preferences.maintenance_prompt`，与网页和 API 操作共用修订号。已加载本 Skill 的 Agent 在每次维护开始时读取偏好，写入前重新读取最新知识库；偏好发生变化时先调整待写结果，再按最新修订号提交。

Agent 可用 `get-preferences` 读取提示词。用户明确要求修改偏好时，使用 `preferences --file /path/to/preferences.json --if-match <revision>`，文件内容为 `{"maintenance_prompt":"用户要求的提示词"}`；空字符串清空，最多 20,000 字符。当前用户指令优先于保存的偏好，偏好不替代证据核验，也不提供额外的删除或外部发送授权。保存偏好不会自动启动后台任务；未加载本 Skill 的第三方 Agent 无法保证遵循它。

当前 API/Skill 覆盖已实现的图谱 CRUD、证据读取、备注、标签、分组、共享选中状态和维护偏好。深度/极速调查由宿主 Agent 执行并通过 API 入库；任务调度、PDF 自动解析、Zotero 自动收录、备份恢复及所有规划中的高级视图操作尚无相应接口。本页的目录兼容说明基于各厂商文档；本项目需分别记录实际宿主版本和端到端运行结果，才可标记该宿主“已验证”。

2026-10-05 实测：Codex 已从 `.agents/skills/show-me-graph` 发现本 Skill；Python CLI 在隔离的 M1 服务和临时知识库上通过创建、修订冲突、修改、批量删除及状态恢复检查。Claude Code `2.1.207` 已从 `.claude/skills/show-me-graph` 调用本 Skill，并执行只读 `health` 命令。CodeBuddy Code 与 Tencent WorkBuddy 桌面客户端在本机均未安装，安装与实际调用仍待验证。Claude 的这次检查只验证了 Skill 发现和只读工具调用，不等同于其完整研究工作流已通过。
