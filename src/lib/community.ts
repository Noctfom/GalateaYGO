type PublicEnvironment = Record<string, unknown>;

export function readCommunityConfig(env: PublicEnvironment) {
  const read = (key: string) => typeof env[key] === 'string' ? (env[key] as string).trim() : '';
  const repository = read('PUBLIC_COMMUNITY_REPOSITORY');
  const discussionSetting = read('PUBLIC_GITHUB_DISCUSSIONS_ENABLED');
  const repoId = read('PUBLIC_GISCUS_REPO_ID');
  const category = read('PUBLIC_GISCUS_CATEGORY');
  const categoryId = read('PUBLIC_GISCUS_CATEGORY_ID');

  if (repository && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error('PUBLIC_COMMUNITY_REPOSITORY must be a GitHub owner/repository, without a URL or extra path');
  }
  if (repository && ['.', '..'].includes(repository.split('/')[1])) {
    throw new Error('PUBLIC_COMMUNITY_REPOSITORY contains an invalid repository name');
  }
  if (discussionSetting && !['true', 'false'].includes(discussionSetting)) {
    throw new Error('PUBLIC_GITHUB_DISCUSSIONS_ENABLED must be true or false');
  }
  if (discussionSetting === 'true' && !repository) {
    throw new Error('PUBLIC_GITHUB_DISCUSSIONS_ENABLED requires PUBLIC_COMMUNITY_REPOSITORY');
  }

  const hasGiscus = Boolean(repoId || category || categoryId);
  if (hasGiscus && (!repository || discussionSetting !== 'true' || !repoId || !category || !categoryId)) {
    throw new Error('giscus requires the community repository, enabled Discussions, repository ID, category and category ID');
  }
  if (hasGiscus && (!/^[A-Za-z0-9_=-]{6,200}$/.test(repoId) || !/^[A-Za-z0-9_=-]{6,200}$/.test(categoryId) || category.length > 100 || /[\r\n\u0000]/.test(category))) {
    throw new Error('Invalid giscus repository ID, category name or category ID');
  }

  const repositoryUrl = repository ? `https://github.com/${repository}` : null;
  const discussionsUrl = repositoryUrl && discussionSetting === 'true' ? `${repositoryUrl}/discussions` : null;
  return {
    repository: repository || null,
    repositoryUrl,
    submissionUrl: repositoryUrl ? `${repositoryUrl}/issues/new?template=model-submission.yml` : null,
    discussionsUrl,
    discussionEnabled: hasGiscus,
    giscus: hasGiscus ? { repoId, category, categoryId } : null,
  };
}

// 公开仓库配置随源码部署，环境变量可用于派生站点覆盖
export function resolveCommunityConfig(env: PublicEnvironment = {}) {
  const values: PublicEnvironment = {
    PUBLIC_COMMUNITY_REPOSITORY: 'Noctfom/GalateaYGO',
    PUBLIC_GITHUB_DISCUSSIONS_ENABLED: 'true',
    ...env,
  };
  // 派生仓库不继承本站的讨论分类，显式关闭讨论时也不加载评论
  const fields = ['PUBLIC_GISCUS_REPO_ID', 'PUBLIC_GISCUS_CATEGORY', 'PUBLIC_GISCUS_CATEGORY_ID'];
  if (values.PUBLIC_COMMUNITY_REPOSITORY === 'Noctfom/GalateaYGO'
      && values.PUBLIC_GITHUB_DISCUSSIONS_ENABLED === 'true'
      && !fields.some(key => typeof values[key] === 'string' && (values[key] as string).trim())) {
    Object.assign(values, {
      PUBLIC_GISCUS_REPO_ID: 'R_kgDOVlSM_Q',
      PUBLIC_GISCUS_CATEGORY: 'Announcements',
      PUBLIC_GISCUS_CATEGORY_ID: 'DIC_kwDOVlSM_c4DKhyU',
    });
  }
  return readCommunityConfig(values);
}

// 这些值仅用于公开链接和评论配置，不接收 GitHub 令牌
export const community = resolveCommunityConfig(import.meta.env ?? {});
