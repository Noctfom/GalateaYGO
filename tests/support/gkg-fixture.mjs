import { createHash, randomUUID } from 'node:crypto';
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const protocol = {
  model_protocol_version: 4, protocol_schema_revision: 1, protocol_schema_hash: hash('schema'),
  card_vocab_hash: hash('vocabulary'), card_vocab_size: 32768, card_vocab_card_count: 13538,
  semantic_lookup_format_version: 1, semantic_lookup_hash: hash('semantics'), semantic_lookup_card_count: 13538,
};

export function manifest(version = 4) {
  const primary = 'galatea_iter_200_bc_5.onnx';
  const result = {
    package_format_version: version, ...protocol, package_name: '测试共享包', build_time: '2026-11-06 20:00:00',
    models_included: [primary], model_files_included: [primary],
    model_artifacts: [{
      ...protocol, model_id: randomUUID(), model_prefix: 'galatea', iteration: 200, format: 'onnx',
      primary, files: [primary], status: 'complete',
      training_lineage: { format_version: 1, base_prefix: 'galatea', ppo_iteration: 200, bc_epochs: 5 },
    }],
  };
  if (version === 5) result.optional_content = {
    format_version: 1,
    files: [{ category: 'decks', path: 'content/decks/烙印池/构筑.ydk', relative_path: '烙印池/构筑.ydk', size: 6, sha256: hash('#main\n') }],
  };
  return result;
}

export async function fixture(value = manifest(), { extra = [], missing = [], zip64 = false, level = 6 } = {}) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false, zip64 });
  const rows = [
    ['manifest.json', JSON.stringify(value)],
    ...value.model_artifacts.flatMap((artifact) => artifact.files.map((name) => [name, 'inert fixture bytes; never execute'])),
    ...(value.optional_content?.files ?? []).map((entry) => [entry.path, '#main\n']),
    ...extra,
  ];
  for (const [name, content] of rows) if (!missing.includes(name)) await writer.add(name, new TextReader(content), { level });
  return writer.close();
}

