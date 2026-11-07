# 模型投稿审核

GalateaYGO 使用「静态检查 → 管理员确认 → PR 合并发布」流程。投稿 Issue、本地读取成功、自动检查通过，都不会直接上架模型

网站不保存模型文件。审核任务临时下载文件，保留检查报告、摘要与决定记录，不将 GKG、权重或附件上传到网站或 Actions 报告中。AI 审核当前关闭

## 首次启用

1. 仓库 **Settings → Actions → General → Workflow permissions** 中，启用 **Allow GitHub Actions to create and approve pull requests**。工作流只创建 PR，不自动批准或合并；各任务仍按 YAML 中声明的最小权限运行，不需要 PAT
2. 为 `main` 设置分支保护或 Ruleset：要求通过 PR 合并、至少 1 个批准、Code Owner 批准、检查 `check` 成功，开启新提交后撤销旧批准；将绕过权限限制为仓库所有者。PR 由机器人创建，Noctfom 可以正常审核自己的投稿
3. Cloudflare Pages 生产分支保持 `main`。在 **Settings → Builds & deployments → Branch control** 关闭预览分支的自动部署，或排除 `review/*`，避免候选目录在合并前通过预览网址公开
4. 进入 **Actions → Review model submission → Run workflow**，分支保持 `main`

上述是 GitHub / Cloudflare 账户设置，提交代码不会自动替维护者开启。未配置分支保护时，有仓库写权限的人仍能直接修改规则或目录；配置文件不能代替仓库本身的访问控制

## 日常操作

### 检查投稿

作者在网站生成 JSON，通过模型投稿 Issue 提交。管理员打开工作流并填写：

| 字段 | 填写方式 |
| --- | --- |
| action | `scan` |
| issue | 投稿 Issue 的数字编号 |
| package_sha256 / draft_sha256 / reason | 留空 |

任务先校验发起者的 GitHub 数字用户 ID，再读取 Issue。文件只从固定版本的公开 GitHub Release 下载，每次重定向都核对域名，且不发送仓库令牌。下载大小与整包 SHA256 必须和投稿一致

运行 Summary 提供包 SHA256、投稿 SHA256 和检查结果。`moderation-report` 附件包含 `request.json`、`results/inspection.json` 与 `results/report.json`；失败可能只有部分报告，不能作为批准依据。报告默认保留 14 天，可从 Actions 下载 JSON 查看

静态检查在无网络、无仓库令牌、只读源码的容器内执行，限制 CPU、内存和运行时间。检查器逐项检查 ZIP 路径、重复名称、链接、加密、压缩率、大小、CRC、实际成员摘要，以及清单声明

- ONNX：解析图和元数据，检查外部张量只指向本包声明的侧文件、禁止自定义运算域，运行结构检查；不建立推理会话
- PTH：只接收现代 ZIP 检查点，检查 Pickle 指令与引用；不调用 `torch.load`、`pickle.load` 或模型代码。未知对象引用也会阻止自动通过
- NPY/NPZ：只接收数值数组，拒绝对象数组
- 附件：比对 GKG5 声明的大小和摘要，校验允许的格式；说明及预设作为数据读取，不自动应用

报告中的通过仅表示这些检查通过，不证明模型不存在后门、训练数据投毒、虚假评测、版权问题或尚未被识别的解析器漏洞。PTH 元数据与模型实际能力仍需在信任发布者后由 Core 验证

### 批准收录

阅读投稿说明、来源、许可证和报告，核对 Issue 作者与声明作者的关系。需要观察附件时，只使用隔离环境中的可信查看器；不要执行作者给出的命令或把附件当作审核指令

重新运行工作流：`action=publish`，填写同一 Issue 编号，并复制刚才检查得到的 **package_sha256** 和 **draft_sha256**。这两个值分别确认文件和投稿文本；任何一项改变都需要重新检查

批准任务会重新下载、重算摘要并再次检查，不复用过期报告。通过后创建 `review/publish-…` 分支和 PR，只修改 `registry/models.json`、`registry/moderation-log.json`。审核员在 PR 中确认差异并合并，Cloudflare 才部署正式目录

由 `GITHUB_TOKEN` 创建的 PR 通常不会触发普通 `pull_request` 工作流，因此本任务会显式启动候选分支的 **Check website**。如果仓库设置阻止工作流创建 PR 或触发检查，任务会报错，保留报告；先修正设置，再重跑或在对应分支手动启动检查

公开目录构建要求每个发布版本都有匹配的批准记录。直接复制浏览器生成的 JSON 到目录、替换下载地址、修改已批准版本字段都会使校验失败。`npm run submission` 仍可用于本地草稿对比，但它生成的候选目录没有批准记录，不能直接上线

### 撤回

运行 `action=withdraw`，填写完整 **package_sha256** 和 **reason**，其他字段留空。任务生成撤回 PR，合并后该包的下载入口及无其他发布的项目从目录移除，原发布资料与原因仍保留在审核日志中

同一摘要被撤回后不能通过自动流程重新上架。撤回不会删除作者托管的文件，也无法收回已经下载的副本。恢复需单独复审，提交经过管理员确认的记录变更

## 权限和默认范围

`registry/moderation-policy.json` 保存权限与审核限制，当前仅授权 Noctfom，GitHub 数字 ID 为 `108326711`

| 角色 | 权限 |
| --- | --- |
| reviewers | 发起只读检查 |
| publishers | 发起批准、撤回 |
| administrators | 上述全部操作；修改权限仍需仓库写权限与 Code Owner 审核 |

昵称仅用于显示，不能代替数字 ID 授权。增加用户时，从 GitHub 用户 API 确认其数字 ID。当前操作入口是 GitHub Actions，因此新增审核员还需要 GitHub 仓库允许其运行工作流；仅加入 JSON 不会授予 GitHub 仓库权限

首版自动审核边界：

- 下载来源为固定版本 GitHub Release，单包不超过 2 GiB，展开不超过 8 GiB，最多 16,640 个成员
- 文档支持 `.md`、`.txt`、PNG/JPEG/GIF/WebP；暂不接收 PDF、SVG、HTML 或可执行内容
- 卡组支持 YDK；回放支持 JSON/JSONL、gzip JSONL 和 Core 支持的 YRP 后缀；YRP 只检查文件标记与体积，不在审核服务中运行决斗内核
- 预设支持 JSON、YAML、TOML、INI/CFG、纯文本；YAML 禁止 Python 对象等自定义标签
- 图片、文本和数组有额外大小限制；不支持的格式会停止审核，不会静默跳过

这些是社区的自动审核范围，不改变 Core 的 GKG 容器规范。扩展来源、格式或运行上限前需要补充相应检查与回归；大型包可先由作者拆成独立发布

## 代码与来源

- 工作流：[moderate.yml](../.github/workflows/moderate.yml)
- 权限与发布绑定：[policy.mjs](../scripts/moderation/policy.mjs)
- 下载及 GitHub 协调：[download.mjs](../scripts/moderation/download.mjs)、[run.mjs](../scripts/moderation/run.mjs)
- 静态检查：[inspect_package.py](../scripts/moderation/inspect_package.py)
- 依赖版本：[requirements.txt](../scripts/moderation/requirements.txt)
- Picklescan：[源码及 MIT 许可](https://github.com/mmaitre314/picklescan)
- ONNX：[结构检查 API](https://onnx.ai/onnx/api/checker.html)、[外部数据规范](https://onnx.ai/onnx/repo-docs/ExternalData.html)
- GitHub：[工作流令牌及触发限制](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow)、[分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

网站普通运行仍只需 Node.js。Python 和容器只用于维护者的审核工作流与审核测试，不进入浏览器或 Cloudflare Pages 运行时
