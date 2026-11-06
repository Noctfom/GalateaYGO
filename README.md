# GalateaYGO

GalateaYGO 是面向 Galatea 模型使用者与创作者的官网和模型目录，提供中文优先、支持英文的模型介绍、版本浏览和使用文档

网站采用 Astro 静态构建，面向 Cloudflare Pages 部署。模型文件由发布者自行存放在 GitHub Releases 或其他模型仓库，网站保留轻量目录与下载来源

## 本地运行

建议使用 Node.js 22.18 或兼容版本，Windows 可双击 `启动预览.bat`

```sh
npm ci
npm run dev
```

打开终端输出的本地地址。开发模式包含明确标记的示例模型，供预览目录、筛选和详情页面；示例没有下载文件，不代表真实发布或实测成绩

```sh
# 构建正式网站
npm run build

# 查看最近一次构建
npm run preview

# 构建包含示例模型的预览网站
npm run build:demo
```

正式构建使用 `registry/models.json` 中的真实目录。初始目录为空，因此上线时会显示等待发布的状态，不会把示例伪装成社区模型。预览构建用于本地评审，不作为正式模型目录分发

## 当前功能

- 首页、模型广场、模型详情与版本浏览
- 中文和英文页面
- 本地搜索与筛选，以及模型使用说明
- 独立的版本化模型清单
- GKG4/5 本地读取、文件摘要与投稿资料生成
- GitHub Issue 投稿模板与可选 giscus 模型讨论
- Cloudflare Pages 静态构建产物

当前版本为 0.2.0。社区仓库为 [Noctfom/GalateaYGO](https://github.com/Noctfom/GalateaYGO)，作者生成投稿资料后复制 JSON 并前往 GitHub 确认提交。网站不代作者创建 Issue，也不运行模型推理或自动安装本地客户端

首页展示卡使用原创插画和游戏王卡面式的名称、属性、等级与效果栏，卡面不是可用于对局的真实卡牌

## 目录数据

`registry/models.json` 保存真实发布条目，`registry/examples.json` 保存展示示例。两类数据分开维护

模型项目标识、Core 模型 UUID 和某次发布版本是不同概念。文件内容改变时，应保留新的发布记录和 SHA256，而不是仅依赖文件名或 UUID 区分内容

技术字段应来自对应制品或部署包的清单；简介、许可证、用途和评测说明由作者填写。不要直接运行外部 PTH 文件来生成网页内容，也不要把大模型文件加入网站仓库

`/catalog/v1.json` 是当前可读取的静态目录接口，始终只输出真实目录，即使使用演示构建也不会包含示例。发布条目可携带 `technical` GKG 信息和 `primaryArtifact` 展示制品，旧目录基础字段保持兼容

新增条目时运行注册表校验和测试，之后构建页面检查显示结果

```sh
npm run validate
npm test
npm run build
```

正式和演示构建都会自动检查站内链接与示例隔离。开发服务器运行时，可用 `npx playwright test` 验证页面交互；Windows 已安装 Chrome 时设置 `PLAYWRIGHT_CHANNEL=chrome`，否则按 Playwright 文档安装 Chromium

为兼容 Node.js 22.18，字体依赖 `unifont` 锁定在 Astro 声明支持范围内的 0.7.4；更高补丁版引入的 `undici` 要求更高 Node 版本。请使用锁文件安装，升级依赖时重新检查运行环境

模型文件使用发布者的外链。优先链接具体版本；多个镜像声称为同一文件时，大小和 SHA256 应一致。网站上的协议说明不能代替 Core 或 Link 导入时的最终兼容检查

## 作者投稿

1. 在 Core 中准备可用的 GKG4/5 部署包，上传到自己的 GitHub Release 或模型仓库
2. 打开网站的「分享模型」，选择本地包。浏览器后台线程读取清单，按 4 MiB 数据块计算整包 SHA256，不上传文件，也不展开或执行模型权重
3. 多制品包选择本次主要展示的模型，其余制品仍保留在技术清单中。PPO 与 BC 轮次分别来自 Core 接续信息，旧 BC 来源不足时需要重新打包
4. 填写介绍、稳定的目录标识、许可证、具体版本发布页与 GKG 下载地址，生成 JSON。可补充另一种语言；没有译文时显示原文
5. 复制 JSON，打开 GitHub 投稿，登录并确认提交。提交本身不会立即出现在目录中，维护者收录后由静态构建发布

也可在命令行单独读取包信息，无需 Python 或 Torch：

```sh
npm run inspect:gkg -- /path/to/model.gkg --output metadata.json
```

该报告用于核对包清单与文件摘要，不代替完整 Core 导入检查，也不证明作者身份或授权关系。命令行生成的技术报告与网站完整投稿 JSON 是两种文件，前者不含作者介绍和下载地址

## 维护者收录

下载投稿 JSON，核对 GitHub 投稿人、模型来源、许可证和具体下载版本。生成待审查目录：

```sh
npm run submission -- submission.json registry.candidate.json
```

命令只写新的候选文件，不覆盖正式目录。新项目加入目录；同项目新版本追加记录，保留旧版本、原有介绍和维护者精选设置。重复文件、作者或路由冲突会提示人工核对。审查候选差异后更新 `registry/models.json`，如需修改原有项目介绍一并手动编辑，运行 `npm test` 与 `npm run build` 后提交 PR

技术清单由作者浏览器生成，属于投稿资料而非可信认证。不要直接执行投稿附带的 PTH；核对文件摘要时可下载 GKG 后运行上述读取命令。网站的 CI 仅校验静态资料与构建，不自动执行投稿内容

## 连接 GitHub 社区

网站源码、模型投稿和讨论共用公开仓库 [Noctfom/GalateaYGO](https://github.com/Noctfom/GalateaYGO)，本目录就是仓库根目录。Issues 与 Discussions 已开启；投稿表单来自默认分支中的 `.github/ISSUE_TEMPLATE/model-submission.yml`。不需要 GitHub Token 或独立账户系统

正式仓库与讨论入口已作为公开默认值保存在 `src/lib/community.ts`，本地运行和 Cloudflare 构建都不依赖未提交的 `.env`。派生站点可复制 `.env.example` 为本地 `.env`，或设置构建环境变量覆盖：

```dotenv
PUBLIC_COMMUNITY_REPOSITORY=你的账号/GalateaYGO
PUBLIC_GITHUB_DISCUSSIONS_ENABLED=true
```

覆盖仓库时，应确认新仓库也有投稿模板和 Discussions；未开启讨论时设置 `PUBLIC_GITHUB_DISCUSSIONS_ENABLED=false`。嵌入评论还需要为该仓库安装 [giscus GitHub App](https://github.com/apps/giscus)，在 [giscus 配置页](https://giscus.app/zh-CN) 选择该仓库与讨论分类，将生成的仓库 ID、分类名称和分类 ID 填入本地 `.env` 或 Cloudflare 构建环境变量。未配置时保留 GitHub 讨论外链

模型页只有用户点击「加载讨论」后才连接 giscus，中英文和不同发布版本共用同一模型目录 ID 的讨论。示例条目不会连接真实讨论。访问 GitHub 投稿或加载 giscus 时遵循对应服务的身份与隐私规则

修改配置后重新构建即可生效。这些配置不含密钥；不要填入 GitHub Token。更换仓库时，giscus 的仓库 ID 与分类 ID 也必须来自新仓库

## Cloudflare Pages 部署

在自己的 Cloudflare 账户中创建 Pages 项目，连接 GitHub 仓库 `Noctfom/GalateaYGO`，生产分支选择 `main`

| 设置 | 值 |
| --- | --- |
| 框架 | Astro 或静态网站 |
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| Node.js | `22.18.0` |
| 网站根目录 | 留空，使用仓库根目录 |

部署时使用正式构建命令，不使用 `build:demo`。如果在单仓库中维护多个项目，将 Pages 的根目录设置为 GalateaYGO 所在目录

Pages 只托管网页、索引和小型静态资源。模型二进制不上传到 Pages；发布者的文件可从原托管地址直接下载

首次部署成功后使用 Cloudflare 分配的 `pages.dev` 地址访问，也可在项目中绑定自有域名。之后主分支变更由 Pages 自动重新构建发布

## 与 Core 和 Link 的关系

GalateaYGO 作为独立网站运行，无需 Python、Torch 或决斗内核。它遵循 Core 的公开制品规范，后续可向 Link 提供静态模型目录

- 模型协议 V4 与 GKG4/5 容器版本分别展示
- 兼容资源维护可能保留模型 UUID，但生成新的文件内容
- GKG5 可包含卡组、回放、说明和预设；预设不自动应用
- 评测结果需注明对手、卡组、局数、先后手和策略设置
- 当前普通 ONNX 输出不等于完整终局胜率辅助头的在线预测能力

Core 的公开规范：[GKG 部署包说明](https://github.com/Noctfom/Galatea-Core/blob/dev/docs/deployment_packages.md)

## 参考来源

实际依赖与设计参考分开记录在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

- [Astro 官方文档](https://docs.astro.build/) · [源码](https://github.com/withastro/astro)
- [Cloudflare Pages 部署 Astro](https://docs.astro.build/en/guides/deploy/cloudflare/) · [Pages 限制](https://developers.cloudflare.com/pages/platform/limits/)
- [GitHub Releases 文件托管说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [Hugging Face 模型卡规范](https://huggingface.co/docs/hub/en/model-cards) · [公共存储政策](https://huggingface.co/docs/hub/en/storage-limits)
- [Modrinth](https://modrinth.com/) · [源码](https://github.com/modrinth/code)
- [Starlight 文档框架](https://starlight.astro.build/) · [源码](https://github.com/withastro/starlight)
- [giscus 评论组件](https://giscus.app/) · [源码](https://github.com/giscus/giscus)

托管方案按 2026-11-06 的公开文档选型；正式发布前请核对服务方当时的额度和要求
