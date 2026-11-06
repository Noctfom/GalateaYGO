# 第三方来源与设计参考

本文件区分实际软件依赖与功能设计参考。参考一个产品的功能组织不代表引入了它的代码或品牌素材

## 实际使用

### Astro

- 用途：静态页面构建、路由和组件
- 官网与文档：https://docs.astro.build/
- 源码：https://github.com/withastro/astro
- 许可证：MIT
- 许可原文：https://github.com/withastro/astro/blob/main/LICENSE

具体依赖版本和传递依赖以 `package.json` 与 `package-lock.json` 为准，各依赖保留自己的许可信息

### Playwright

- 用途：开发阶段的浏览器验证，不作为网站运行服务
- 官网：https://playwright.dev/
- 源码：https://github.com/microsoft/playwright
- 许可证：Apache-2.0
- 许可原文：https://github.com/microsoft/playwright/blob/main/LICENSE

### zip.js 与 noble-hashes

- zip.js 用于读取 GKG 的 ZIP 目录和清单，支持 ZIP64 与中文路径
- 官方 API：https://gildas-lormeau.github.io/zip.js/api/index.html
- 源码：https://github.com/gildas-lormeau/zip.js
- 许可证：BSD-3-Clause，https://github.com/gildas-lormeau/zip.js/blob/master/LICENSE
- noble-hashes 用于分块计算整包 SHA256，不需要把整个文件保存在内存
- 源码与文档：https://github.com/paulmillr/noble-hashes
- 许可证：MIT，https://github.com/paulmillr/noble-hashes/blob/main/LICENSE
- 两者是实际运行依赖，版本固定在锁文件中；模型文件不会发送给这些项目或外部服务

## 功能与信息组织参考

### Hugging Face Model Cards

- 参考范围：模型用途、限制、来源与评测说明的组织方式
- 规范：https://huggingface.co/docs/hub/en/model-cards
- 规范源码：https://github.com/huggingface/hub-docs
- 文档仓库许可：https://github.com/huggingface/hub-docs/blob/main/LICENSE
- 本项目没有引入 Hugging Face 平台后台或复制其品牌素材

### Modrinth

- 参考范围：项目列表、筛选、版本页面和作者信息的组织方式
- 官网：https://modrinth.com/
- 源码：https://github.com/modrinth/code
- 许可说明：https://github.com/modrinth/code/blob/main/COPYING.md
- Modrinth 各子项目许可分别适用；本项目没有复制其源码、图标、标志或品牌素材

### Starlight

- 参考范围：文档导航、多语言和可读性；作为后续文档组件候选
- 官网：https://starlight.astro.build/
- 源码：https://github.com/withastro/starlight
- 许可证：https://github.com/withastro/starlight/blob/main/LICENSE
- 当前批次未安装或使用 Starlight

### giscus

- 用途：可选的 GitHub Discussions 模型讨论，用户点击后加载
- 官网：https://giscus.app/
- 源码：https://github.com/giscus/giscus
- 许可证：https://github.com/giscus/giscus/blob/main/LICENSE
- 已实现配置入口，实际仓库与讨论分类由维护者设置；默认不加载外部脚本
- 严格讨论映射：https://github.com/giscus/giscus/blob/main/ADVANCED-USAGE.md

### GitHub 投稿与 Cloudflare Pages

- 投稿链接与 URL 参数：https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue
- Issue 表单格式：https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms
- Astro 部署说明：https://docs.astro.build/en/guides/deploy/cloudflare/
- Pages 只托管网站产物；模型由作者托管，不经网站中转

## Galatea 公开协议

- 项目：https://github.com/Noctfom/Galatea-Core
- 部署包说明：https://github.com/Noctfom/Galatea-Core/blob/dev/docs/deployment_packages.md
- 本网站说明 GKG 和模型协议的区别；用户导入时仍以 Core 或 Link 的实际支持和检查结果为准

## 内容与模型文件

模型、卡组、回放、说明及预设的许可由各发布者声明，不能从网站依赖的许可证或 Core 许可证自动推断。示例条目只是界面展示数据，不代表实际发布模型
