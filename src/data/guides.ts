type LocalizedText = { zh: string; en: string };

export type Guide = {
  slug: string;
  title: LocalizedText;
  summary: LocalizedText;
  category: LocalizedText;
  readMinutes: number;
  sections: { title: LocalizedText; body: LocalizedText }[];
};

export const guides: Guide[] = [
  {
    slug: 'getting-started',
    title: { zh: '从找到模型，到开始第一场对局', en: 'From finding a model to your first duel' },
    summary: {
      zh: '认识 GalateaYGO、Core 和 Link，按自己的用途找到合适的入口',
      en: 'Understand GalateaYGO, Core and Link, then choose the right starting point.',
    },
    category: { zh: '快速开始', en: 'Getting started' },
    readMinutes: 3,
    sections: [
      {
        title: { zh: '先确定你想做什么', en: 'Start with your goal' },
        body: {
          zh: 'GalateaYGO 帮你发现模型、阅读说明和找到下载来源。Galatea-Core 提供训练、测试、模型打包及本地回放等功能；Galatea-Link 负责客户端侧的模型接入。网页本身不运行决斗模型，也不会自动修改你的本地配置。',
          en: 'GalateaYGO helps you discover models, read their documentation and find download sources. Galatea-Core provides training, evaluation, packaging and local replay tools. Galatea-Link handles client-side model integration. This website does not run duel models or change your local configuration.',
        },
      },
      {
        title: { zh: '阅读模型页，再选择版本', en: 'Read the model page and choose a release' },
        body: {
          zh: '先看模型用途、作者说明和文件格式，再查看该版本声明的协议与客户端要求。训练轮数较多不一定意味着更适合你的卡组或设备。示例条目只用于展示网站功能，没有可下载的模型，也不代表已经完成评测。',
          en: 'Check the intended use, author notes and file format, then review the release’s protocol and client requirements. More training iterations do not necessarily make a model better for your deck or hardware. Example listings demonstrate the website and contain no downloadable model or measured evaluation results.',
        },
      },
      {
        title: { zh: '从发布者的来源下载', en: 'Download from the publisher’s source' },
        body: {
          zh: '下载入口会带你前往发布者提供的文件来源。保留完整文件名和配套文件，下载完成后可将 SHA256 与发布清单对照。使用 GKG 包时，按本机 Core 或 Link 的导入说明操作，最终兼容检查以客户端读取结果为准。',
          en: 'Download links lead to files hosted by the publisher. Keep the complete filenames and companion files, and compare the downloaded file’s SHA256 with the release record. For GKG packages, follow your installed Core or Link import instructions. The client’s import checks determine actual compatibility.',
        },
      },
      {
        title: { zh: '遇到问题时保留这些信息', en: 'Keep the details needed for troubleshooting' },
        body: {
          zh: '记录模型名称、发布版本、下载来源、客户端版本及具体错误信息。反馈模型使用问题时优先查看作者给出的反馈入口；讨论框架问题时使用对应 Core 或 Link 项目的反馈入口。无需公开本机凭据或私人对局数据。',
          en: 'Record the model name, release, download source, client version and exact error. Use the author’s feedback channel for model-specific issues, or the relevant Core or Link project for framework issues. You do not need to share local credentials or private duel data.',
        },
      },
    ],
  },
  {
    slug: 'choose-model',
    title: { zh: '如何选择适合自己的模型', en: 'How to choose a model' },
    summary: {
      zh: '从用途、资源需求和评测条件出发，理解模型之间的差异',
      en: 'Compare intended use, resource needs and evaluation conditions.',
    },
    category: { zh: '模型使用', en: 'Using models' },
    readMinutes: 4,
    sections: [
      {
        title: { zh: '标签描述方向，不能代替实测', en: 'Tags describe a focus, not a measured result' },
        body: {
          zh: '通用模型通常面向更多卡组；专项模型可能集中训练某种构筑或对局；轻量模型侧重较低的运行负担。它们是作者对用途的描述。模型是否适合你，仍要结合实际支持的卡牌、资源要求和同条件对局表现判断。',
          en: 'General models aim to cover a wider range of decks. Specialist models may focus on particular builds or matchups. Lightweight models prioritize a smaller runtime footprint. These are descriptions of intent; supported cards, resource requirements and comparable matches still matter.',
        },
      },
      {
        title: { zh: '比较胜率时，先看测试条件', en: 'Read the test conditions before comparing win rates' },
        body: {
          zh: '对手类型、双方卡组、测试局数、先后手分配、策略模式和温度都会影响结果。镜像 WindBot 对局、常规训练池对局和历史模型对局不能直接合并成同一个实力结论。没有评测报告时，应当把该条目视为尚未提供评测，而不是默认表现较差或较好。',
          en: 'Opponent type, both decks, game count, turn order, policy mode and temperature affect results. WindBot mirror matches, regular deck-pool matches and historical-model matches do not form one interchangeable strength measure. A missing report means evaluation has not been provided, not that the model is necessarily weak or strong.',
        },
      },
      {
        title: { zh: '区分部署和继续训练', en: 'Distinguish deployment from continued training' },
        body: {
          zh: 'ONNX 常用于部署推理，PTH 检查点用于 Core 内的训练或继续训练。GKG 可以把模型与所需词表、运行语义资产和可选附件放在一起。准备继续训练时，确认作者是否提供了合适的检查点；只有 ONNX 文件不等于能够恢复原训练过程。',
          en: 'ONNX is commonly used for deployment inference, while PTH checkpoints support training or continued training in Core. GKG can package models, vocabulary, runtime semantic assets and optional content together. To continue training, check that a suitable checkpoint is supplied; an ONNX file alone does not restore the original training process.',
        },
      },
      {
        title: { zh: '选择与你的环境匹配的发布版本', en: 'Choose a release that matches your environment' },
        body: {
          zh: '相同模型协议不代表所有词表和语义资源都可以互换。查看作者声明的兼容信息，优先使用完整的配套发布文件。设备需求若仅为作者测得结果，应结合其模型规模、运行后端和硬件条件理解。',
          en: 'The same model protocol does not make all vocabularies and semantic resources interchangeable. Review the compatibility information and prefer the complete set of companion assets. Interpret reported hardware requirements in the context of the author’s model size, runtime and test hardware.',
        },
      },
    ],
  },
  {
    slug: 'publish-model',
    title: { zh: '发布你的第一个模型', en: 'Publish your first model' },
    summary: {
      zh: '准备发行文件、描述用途，让其他人能够找到并使用你的成果',
      en: 'Prepare release files and useful documentation so others can use your work.',
    },
    category: { zh: '创作者指南', en: 'For creators' },
    readMinutes: 4,
    sections: [
      {
        title: { zh: '先准备可使用的发行文件', en: 'Prepare a usable release' },
        body: {
          zh: '在 Core 中确认模型可以正常加载，按用途准备部署包或训练检查点。如果 ONNX 使用外置权重，需要同时提供对应文件。可将卡组、回放、说明和预设放入 GKG5；这些附件不会自动成为模型输入，也不会自动应用到用户的训练配置。',
          en: 'Confirm that the model loads in Core, then prepare a deployment package or training checkpoint for its intended use. ONNX models with external weights need their companion files. GKG5 can include decks, replays, documentation and presets; these do not automatically become model inputs or modify a user’s training configuration.',
        },
      },
      {
        title: { zh: '由你选择文件托管位置', en: 'Choose where to host your files' },
        body: {
          zh: '模型文件由发布者托管，GalateaYGO 收录说明和下载地址。GitHub Releases 适合小于 2 GiB 的单个文件；较大的文件可选择支持该体积的模型仓库。提供指向具体版本的地址，避免同一个下载链接悄悄变成另一个模型。',
          en: 'Publishers host their files; GalateaYGO lists documentation and download links. GitHub Releases supports individual files smaller than 2 GiB. Larger files can use a model repository that supports their size. Link to a specific release rather than silently changing the content behind one download URL.',
        },
      },
      {
        title: { zh: '把用途和来源写清楚', en: 'Explain the purpose and provenance' },
        body: {
          zh: '说明模型适用的任务、训练方向、已知限制、使用方法和许可证。如果模型基于其他作者的成果继续训练，请注明来源。评测报告应写清对手、卡组、局数和策略设置。没有测过的指标留空即可，不要把示例值填成实测成绩。',
          en: 'Describe the intended tasks, training focus, known limitations, usage and license. Credit the original work when continuing another author’s model. Evaluation reports should specify opponents, decks, game counts and policy settings. Leave unmeasured metrics empty instead of presenting examples as real results.',
        },
      },
      {
        title: { zh: '生成投稿资料', en: 'Prepare submission information' },
        body: {
          zh: '在发布页选择本地 GKG，网页会在后台读取清单并分块计算文件摘要，不上传或运行模型。多模型包可以选择主要展示的版本。填写介绍、许可证和下载地址后保存 JSON；社区仓库开放后，复制 JSON 到 GitHub 投稿表单，确认提交并等待维护者收录。每次文件内容变化都新增发布记录，保留旧版本。',
          en: 'Choose a local GKG on the publishing page. A background reader reads its manifest and hashes the file in chunks without uploading or running the model. Select the featured artifact in a multi-model package. Add your description, license and download links, then save the JSON. Once the community repository is open, copy it into the GitHub submission form, confirm and wait for maintainer review. Add a release when file contents change and retain earlier versions.',
        },
      },
    ],
  },
  {
    slug: 'understand-formats',
    title: { zh: '读懂 GKG、ONNX 与版本标识', en: 'Understand GKG, ONNX and version identifiers' },
    summary: {
      zh: '分清模型协议、包格式与发布版本，避免把不同的版本号混为一谈',
      en: 'Separate model protocols, package formats and release versions.',
    },
    category: { zh: '格式与兼容', en: 'Formats & compatibility' },
    readMinutes: 4,
    sections: [
      {
        title: { zh: 'V4 和 GKG5 说的是不同的事', en: 'V4 and GKG5 describe different things' },
        body: {
          zh: '模型协议 V4 描述模型与框架之间的数据约定。GKG4 和 GKG5 是部署包容器版本；GKG5 增加了卡组、回放、说明和预设等附件能力。一个 GKG5 包仍然可以携带 V4 模型，它不代表网络已经升级成 V5。',
          en: 'Model protocol V4 describes the data contract between a model and its framework. GKG4 and GKG5 are deployment container versions. GKG5 adds support for decks, replays, documentation and presets. A GKG5 package can still contain a V4 model; it does not mean the network has become V5.',
        },
      },
      {
        title: { zh: '模型文件之外还有配套资源', en: 'A model may need companion resources' },
        body: {
          zh: '词表决定卡片身份如何编码，运行语义资产提供卡片语义查表数据。它们需要与模型制品的声明相匹配。只有模型主文件、缺少外置权重或配套资产时，可能无法完整部署。客户端会按自己的支持范围核对这些信息。',
          en: 'The vocabulary determines card identity encoding, and runtime semantic assets provide card-semantic lookup data. They need to match the model artifact’s declared requirements. A primary model file without its external weights or companion assets may be insufficient for deployment. Clients verify these requirements within their supported formats.',
        },
      },
      {
        title: { zh: 'UUID 保留身份，发布版本定位文件', en: 'A UUID tracks identity; a release identifies files' },
        body: {
          zh: 'Core 的模型 UUID 用于保留训练身份和相关制品关系。继续训练或兼容的语义资源维护可能保留该身份，但文件内容已经变化。因此社区会分别记录模型项目、发布版本和文件 SHA256。摘要可用于比对文件内容，不等于作者签名或模型实力证明。',
          en: 'A Core model UUID preserves training identity and related artifacts. Continued training or compatible semantic-resource maintenance can preserve that identity while changing file contents. The community therefore distinguishes the model project, release and file SHA256. A digest compares file contents; it is not an author signature or evidence of playing strength.',
        },
      },
      {
        title: { zh: '附件的能力取决于读取它的客户端', en: 'Attachment support depends on the client' },
        body: {
          zh: '卡组可作为可选导入内容；回放可以下载后用支持其格式的工具读取；预设目前只携带和查看，不会自动应用。包中存在回放也不代表网页能重新运行模型生成预测曲线。已有预测记录与重新推理是两种不同能力。',
          en: 'Decks can be optional imports, and downloaded replays need a reader that supports their format. Presets are currently carried and viewed, not automatically applied. A replay inside a package does not mean the website can rerun the model to generate prediction curves. Displaying recorded predictions and running new inference are separate capabilities.',
        },
      },
    ],
  },
];
