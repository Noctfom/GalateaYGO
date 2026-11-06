import { BlobReader, ZipReader } from '@zip.js/zip.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const MiB = 1024 * 1024;
const MAX_PACKAGE = 64 * 1024 * MiB;
const MAX_MANIFEST = 32 * MiB;
const MAX_DIRECTORY = 32 * MiB;
const MAX_MEMBERS = 16640;
const CATEGORIES = ['decks', 'replays', 'documents', 'presets'];
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class GkgInspectionError extends Error {
  constructor(code, zh, en) {
    super(zh);
    this.name = 'GkgInspectionError';
    this.code = code;
    this.messages = { zh, en };
  }
}

function fail(code, zh, en) { throw new GkgInspectionError(code, zh, en); }
function abort(signal) { signal?.throwIfAborted(); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function text(value, max = 512) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }

function pathIsSafe(value) {
  return text(value, 4096) && !value.startsWith('/') && !/[\\:]/.test(value)
    && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

async function readView(blob, start, length) {
  if (!integer(start) || !integer(length) || start + length > blob.size) {
    fail('archive', 'GKG 的 ZIP 索引已损坏', 'The GKG ZIP directory is damaged');
  }
  return new DataView(await blob.slice(start, start + length).arrayBuffer());
}

function uint64(view, offset) {
  const result = Number(view.getBigUint64(offset, true));
  if (!Number.isSafeInteger(result)) fail('archive', 'ZIP64 索引超过可读取范围', 'The ZIP64 directory exceeds the supported range');
  return result;
}

// 先限制中央目录，避免恶意压缩包在读取清单前分配超大索引
async function inspectDirectory(blob, signal) {
  abort(signal);
  const tailStart = Math.max(0, blob.size - 65557);
  const tail = await readView(blob, tailStart, blob.size - tailStart);
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) {
      end = i;
      break;
    }
  }
  if (end < 0) fail('archive', '文件不是完整的 GKG/ZIP 压缩包', 'The file is not a complete GKG/ZIP archive');
  const endOffset = tailStart + end;
  const disk = tail.getUint16(end + 4, true);
  const directoryDisk = tail.getUint16(end + 6, true);
  if (![0, 0xffff].includes(disk) || ![0, 0xffff].includes(directoryDisk)) {
    fail('archive', '不支持分卷 GKG 文件', 'Split GKG archives are not supported');
  }
  let count = tail.getUint16(end + 10, true);
  let directorySize = tail.getUint32(end + 12, true);
  let directoryOffset = tail.getUint32(end + 16, true);
  if (disk === 0xffff || directoryDisk === 0xffff || count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    const locator = await readView(blob, endOffset - 20, 20);
    if (locator.getUint32(0, true) !== 0x07064b50 || locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) !== 1) {
      fail('archive', 'ZIP64 索引无效或为分卷格式', 'The ZIP64 directory is invalid or split across files');
    }
    const zip64Offset = uint64(locator, 8);
    const extended = await readView(blob, zip64Offset, 56);
    if (extended.getUint32(0, true) !== 0x06064b50 || uint64(extended, 4) < 44
        || extended.getUint32(16, true) !== 0 || extended.getUint32(20, true) !== 0
        || zip64Offset + 12 + uint64(extended, 4) !== endOffset - 20) {
      fail('archive', 'ZIP64 索引已损坏', 'The ZIP64 directory is damaged');
    }
    count = uint64(extended, 32);
    directorySize = uint64(extended, 40);
    directoryOffset = uint64(extended, 48);
    if (uint64(extended, 24) !== count || directoryOffset + directorySize > zip64Offset) {
      fail('archive', 'ZIP64 文件数量或目录位置无效', 'The ZIP64 entry count or directory offset is invalid');
    }
  } else if (tail.getUint16(end + 8, true) !== count) {
    fail('archive', 'ZIP 文件数量无效', 'The ZIP entry count is invalid');
  }
  if (!count || count > MAX_MEMBERS || directorySize > MAX_DIRECTORY || directoryOffset + directorySize > endOffset) {
    fail('limits', 'GKG 索引数量、大小或位置超出读取范围', 'The GKG directory count, size or offset is outside the supported range');
  }
  return count;
}

async function readManifest(entry, signal) {
  if (entry.encrypted || entry.directory || !integer(entry.uncompressedSize) || entry.uncompressedSize > MAX_MANIFEST) {
    fail('manifest', 'GKG 清单被加密、无效或超过 32 MiB', 'The GKG manifest is encrypted, invalid or larger than 32 MiB');
  }
  const chunks = [];
  let size = 0;
  const writable = new WritableStream({
    write(chunk) {
      size += chunk.byteLength;
      if (size > MAX_MANIFEST || size > entry.uncompressedSize) {
        fail('limits', 'GKG 清单展开大小超出声明或读取上限', 'The GKG manifest expands beyond its declared size or the read limit');
      }
      chunks.push(chunk);
    },
  });
  await entry.getData(writable, { checkSignature: true, signal, useWebWorkers: false });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (size !== entry.uncompressedSize) fail('manifest', 'GKG 清单长度与索引不一致', 'The GKG manifest size does not match its directory record');
  try {
    return { manifest: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), size };
  } catch {
    fail('manifest', 'GKG 清单必须是有效的 UTF-8 JSON', 'The GKG manifest must contain valid UTF-8 JSON');
  }
}

function protocolInfo(manifest) {
  const fields = {
    schemaRevision: 'protocol_schema_revision', schemaHash: 'protocol_schema_hash',
    cardVocabHash: 'card_vocab_hash', cardVocabSize: 'card_vocab_size', cardCount: 'card_vocab_card_count',
    semanticLookupHash: 'semantic_lookup_hash', semanticLookupFormatVersion: 'semantic_lookup_format_version',
    semanticLookupCardCount: 'semantic_lookup_card_count',
  };
  const result = {};
  for (const [name, key] of Object.entries(fields)) {
    const value = manifest[key];
    if (name.endsWith('Hash') ? !HASH.test(value ?? '') : !integer(value)) {
      fail('protocol', `GKG 协议字段缺失或无效：${key}`, `A GKG protocol field is missing or invalid: ${key}`);
    }
    result[name] = value;
  }
  return result;
}

function describeManifest(manifest, entries, size) {
  if (!object(manifest) || ![4, 5].includes(manifest.package_format_version)) {
    fail('version', '当前仅支持 GKG4 与 GKG5 部署包', 'Only GKG4 and GKG5 deployment packages are supported');
  }
  const packageFormat = manifest.package_format_version;
  if ((packageFormat === 4 && (size > 2 * MiB || entries.size > 256)) || entries.size > MAX_MEMBERS) {
    fail('limits', 'GKG 文件数量或清单大小超过容器规范', 'The GKG entry count or manifest size exceeds its container specification');
  }
  if (manifest.model_protocol_version !== 4) fail('protocol', '当前模型目录仅接收 V4 模型协议', 'The model directory currently accepts model protocol V4 only');
  if (!text(manifest.package_name) || !text(manifest.build_time, 128)) {
    fail('manifest', 'GKG 缺少包名称或构建时间', 'The GKG package name or build time is missing');
  }
  if (!Array.isArray(manifest.model_artifacts) || !manifest.model_artifacts.length || manifest.model_artifacts.length > 256) {
    fail('models', 'GKG 没有可登记的模型制品', 'The GKG has no model artifacts to register');
  }
  let modelId;
  let modelPrefix;
  const primaryNames = new Set();
  const artifacts = manifest.model_artifacts.map((record) => {
    if (!object(record) || !['onnx', 'pytorch_checkpoint'].includes(record.format)
        || record.status !== 'complete' || record.model_protocol_version !== 4
        || !UUID.test(record.model_id ?? '') || !text(record.model_prefix, 200) || !integer(record.iteration)
        || !pathIsSafe(record.primary) || record.primary.includes('/') || primaryNames.has(record.primary)
        || !Array.isArray(record.files) || !record.files.length || !record.files.includes(record.primary)) {
      fail('models', 'GKG 模型制品声明不完整或包含重复模型文件', 'The GKG model artifact declaration is incomplete or contains duplicate model files');
    }
    primaryNames.add(record.primary);
    if (record.files.some((file) => !pathIsSafe(file) || file.includes('/') || !entries.has(file))) {
      fail('models', 'GKG 缺少声明的模型文件，或模型文件路径无效', 'A declared model file is missing or its path is invalid');
    }
    if (modelId && (modelId !== record.model_id || modelPrefix !== record.model_prefix)) {
      fail('models', '同一个 GKG 不能混合不同模型身份或前缀', 'One GKG cannot mix different model identities or prefixes');
    }
    modelId = record.model_id;
    modelPrefix = record.model_prefix;
    const lineage = record.training_lineage;
    let ppoIteration = record.iteration;
    let bcIteration = 0;
    if (lineage != null) {
      if (!object(lineage) || lineage.format_version !== 1 || !integer(lineage.ppo_iteration) || !integer(lineage.bc_epochs)) {
        fail('lineage', 'GKG 中的 PPO/BC 接续计数无效', 'The PPO/BC lineage counters in the GKG are invalid');
      }
      ppoIteration = lineage.ppo_iteration;
      bcIteration = lineage.bc_epochs;
    } else if (record.training_stage === 'imitation') {
      // 旧 BC 清单没有足够来源时不把本地 BC 轮次误写成 PPO 轮次
      ppoIteration = null;
      bcIteration = null;
    }
    return {
      format: record.format, primary: record.primary, files: [...record.files], iteration: record.iteration,
      ppoIteration, bcIteration, trainingStage: record.training_stage ?? 'ppo',
    };
  });
  const attachmentCounts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  const contentPaths = new Set();
  if (packageFormat === 4 && manifest.optional_content !== undefined) {
    fail('content', 'GKG4 不应声明共享附件', 'GKG4 must not declare shared attachments');
  }
  if (packageFormat === 5) {
    const content = manifest.optional_content;
    if (!object(content) || content.format_version !== 1 || !Array.isArray(content.files) || !content.files.length || content.files.length > 16384) {
      fail('content', 'GKG5 的共享附件清单无效', 'The GKG5 shared-content manifest is invalid');
    }
    for (const file of content.files) {
      if (!object(file) || !CATEGORIES.includes(file.category) || !pathIsSafe(file.path)
          || !pathIsSafe(file.relative_path) || file.path !== `content/${file.category}/${file.relative_path}`
          || !integer(file.size) || !HASH.test(file.sha256 ?? '') || contentPaths.has(file.path)
          || entries.get(file.path)?.uncompressedSize !== file.size) {
        fail('content', 'GKG5 附件声明与包内目录不一致', 'A GKG5 attachment declaration does not match the archive directory');
      }
      contentPaths.add(file.path);
      attachmentCounts[file.category]++;
    }
  }
  for (const name of entries.keys()) {
    if (name.includes('/') && !contentPaths.has(name)) {
      fail('content', 'GKG 含有未声明的嵌套文件', 'The GKG contains an undeclared nested file');
    }
  }
  return {
    packageName: manifest.package_name, buildTime: manifest.build_time, packageFormat, modelProtocol: 4,
    modelId, modelPrefix, artifacts, attachments: CATEGORIES.filter((category) => attachmentCounts[category] > 0),
    attachmentCounts, protocol: protocolInfo(manifest),
  };
}

export async function hashBlob(blob, { onProgress, signal } = {}) {
  const hash = sha256.create();
  const chunkSize = 4 * MiB;
  onProgress?.({ phase: 'hash', loaded: 0, total: blob.size });
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      abort(signal);
      const chunk = new Uint8Array(await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer());
      hash.update(chunk);
      onProgress?.({ phase: 'hash', loaded: Math.min(offset + chunkSize, blob.size), total: blob.size });
      // 每个数据块归还事件循环，让进度显示与取消操作及时响应
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    abort(signal);
    return bytesToHex(hash.digest());
  } finally { hash.destroy(); }
}

// JSON 导入只检查报告形状，报告中的身份和摘要仍需维护者核对发布来源
export function validateInspection(report) {
  const invalid = () => fail('report', '技术信息 JSON 不是有效的 GalateaYGO GKG 检查报告', 'The technical JSON is not a valid GalateaYGO GKG inspection report');
  if (!object(report) || report.schemaVersion !== 1 || report.inspection !== 'manifest-and-package-hash'
      || ![4, 5].includes(report.packageFormat) || report.modelProtocol !== 4
      || !text(report.filename, 4096) || !text(report.packageName) || !text(report.buildTime, 128)
      || !UUID.test(report.modelId ?? '') || !text(report.modelPrefix, 200)
      || !integer(report.sizeBytes) || !report.sizeBytes || report.sizeBytes > MAX_PACKAGE || !HASH.test(report.sha256 ?? '')
      || !Array.isArray(report.artifacts) || !report.artifacts.length || report.artifacts.length > 256
      || !Array.isArray(report.attachments) || !object(report.attachmentCounts) || !object(report.protocol)) invalid();
  const primaries = new Set();
  for (const artifact of report.artifacts) {
    if (!object(artifact) || !['onnx', 'pytorch_checkpoint'].includes(artifact.format)
        || !pathIsSafe(artifact.primary) || artifact.primary.includes('/') || primaries.has(artifact.primary)
        || !integer(artifact.iteration) || !text(artifact.trainingStage, 128)
        || !Array.isArray(artifact.files) || !artifact.files.length || artifact.files.length > 256
        || !artifact.files.includes(artifact.primary) || artifact.files.some((file) => !pathIsSafe(file) || file.includes('/'))
        || !((integer(artifact.ppoIteration) && integer(artifact.bcIteration))
          || (artifact.trainingStage === 'imitation' && artifact.ppoIteration === null && artifact.bcIteration === null))) invalid();
    primaries.add(artifact.primary);
  }
  let count = 0;
  for (const category of CATEGORIES) {
    const value = report.attachmentCounts[category];
    if (!integer(value) || value > 16384) invalid();
    count += value;
  }
  const expected = CATEGORIES.filter((category) => report.attachmentCounts[category] > 0);
  if (count > 16384 || JSON.stringify(report.attachments) !== JSON.stringify(expected)
      || (report.packageFormat === 4 ? count !== 0 : count === 0)) invalid();
  for (const key of ['schemaRevision', 'cardVocabSize', 'cardCount', 'semanticLookupFormatVersion', 'semanticLookupCardCount']) {
    if (!integer(report.protocol[key])) invalid();
  }
  for (const key of ['schemaHash', 'cardVocabHash', 'semanticLookupHash']) if (!HASH.test(report.protocol[key] ?? '')) invalid();
  return report;
}

export async function inspectGkg(blob, { onProgress, signal, filename = blob?.name ?? 'package.gkg' } = {}) {
  abort(signal);
  if (!blob || typeof blob.slice !== 'function' || !integer(blob.size) || blob.size < 22 || blob.size > MAX_PACKAGE) {
    fail('file', '请选择完整的 GKG 文件，包体不能超过 64 GiB', 'Select a complete GKG file no larger than 64 GiB');
  }
  if (!text(filename, 4096)) fail('file', 'GKG 文件名无效', 'The GKG filename is invalid');
  let reader;
  let description;
  try {
    onProgress?.({ phase: 'manifest', loaded: 0, total: 1 });
    const expectedCount = await inspectDirectory(blob, signal);
    reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
    const entries = new Map();
    const normalized = new Set();
    let count = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      abort(signal);
      count++;
      const key = entry.filename.normalize('NFC').toLowerCase();
      if (count > MAX_MEMBERS || entry.directory || !pathIsSafe(entry.filename) || normalized.has(key)) {
        fail('archive', 'GKG 包含重复、无效的路径或过多文件', 'The GKG contains duplicate or invalid paths, or too many files');
      }
      normalized.add(key);
      entries.set(entry.filename, entry);
    }
    if (count !== expectedCount || !entries.has('manifest.json')) {
      fail('manifest', 'GKG 缺少根目录 manifest.json 或 ZIP 索引不完整', 'The GKG lacks a root manifest.json or has an incomplete ZIP directory');
    }
    const { manifest, size } = await readManifest(entries.get('manifest.json'), signal);
    description = describeManifest(manifest, entries, size);
    onProgress?.({ phase: 'manifest', loaded: 1, total: 1 });
  } catch (error) {
    if (error instanceof GkgInspectionError || signal?.aborted || error?.name === 'AbortError') throw error;
    fail('archive', '无法读取 GKG 清单，文件可能损坏或采用不支持的压缩方式', 'The GKG manifest could not be read; the file may be damaged or use unsupported compression');
  } finally { await reader?.close(); }
  const digest = await hashBlob(blob, { onProgress, signal });
  return validateInspection({
    schemaVersion: 1, filename, ...description, sizeBytes: blob.size, sha256: digest,
    inspection: 'manifest-and-package-hash',
  });
}
