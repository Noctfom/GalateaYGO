import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { githubRelease } from './policy.mjs';

export function validateRedirect(url, policy) {
  const value = new URL(url);
  if (value.protocol !== 'https:' || value.port || value.username || value.password || value.hash
      || !policy.redirectHosts.includes(value.hostname)) throw new Error('下载重定向离开受支持的 GitHub 文件域名');
  return value.href;
}

// 仅下载固定发布资产，不向文件地址发送 GitHub Token
export async function downloadPackage(release, policy, output) {
  githubRelease(release.url, policy);
  if (release.sizeBytes > policy.limits.packageBytes) throw new Error('包体超过本次自动审核容量，请拆分发布');
  const signal = AbortSignal.timeout(policy.limits.downloadSeconds * 1000);
  let current = release.url;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await fetch(validateRedirect(current, policy), { redirect: 'manual', signal, headers: { 'User-Agent': 'GalateaYGO-review', 'Accept-Encoding': 'identity' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (!response.headers.get('location')) throw new Error('文件重定向缺少地址');
      current = new URL(response.headers.get('location'), current).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`下载失败，HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared && declared !== release.sizeBytes) { await response.body.cancel(); throw new Error('下载大小与投稿不符'); }
    const hash = createHash('sha256');
    let bytes = 0;
    const counter = new Transform({ transform(chunk, encoding, next) {
      bytes += chunk.length;
      if (bytes > policy.limits.packageBytes || bytes > release.sizeBytes) return next(new Error('下载超过声明大小或审核上限'));
      hash.update(chunk); next(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(output, { flags: 'wx' }), { signal });
    if (bytes !== release.sizeBytes || hash.digest('hex') !== release.sha256) throw new Error('下载内容 SHA256 与投稿不符');
    return;
  }
  throw new Error('下载重定向过多');
}
