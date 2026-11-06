import { inspectGkg } from './gkg.mjs';

// 大包读取与摘要计算放在独立线程，取消时直接终止线程
self.onmessage = async ({ data }: MessageEvent<File>) => {
  try {
    const report = await inspectGkg(data, {
      filename: data.name,
      onProgress: (progress: unknown) => self.postMessage({ type: 'progress', progress }),
    });
    self.postMessage({ type: 'complete', report });
  } catch (error: any) {
    self.postMessage({ type: 'error', messages: error.messages || {
      zh: '无法读取此部署包，请确认它由支持 V4 的 Core 导出',
      en: 'Unable to read this package. Check that it was exported by a V4-compatible Core.',
    } });
  }
};
