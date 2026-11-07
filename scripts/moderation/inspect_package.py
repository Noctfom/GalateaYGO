"""只读静态检查 GKG，不反序列化 PTH 对象，不执行 ONNX、附件或预设"""

import argparse
import gzip
import hashlib
import io
import json
import math
import pickletools
import re
import stat
import tempfile
import unicodedata
import zipfile
from pathlib import Path


ROOT_FILES = {
    'card_vocab.json', 'meta_staples.json', 'knowledge_base.json',
    'hash_mapping_report.json', 'code_embeddings.npy', 'code_embeddings_idx.json',
    'code_embeddings_meta.json', 'semantic_compatibility_v1.json',
    'semantic_lookup_v1.npz', 'semantic_lookup_v1.json',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_name(name):
    require(isinstance(name, str) and 0 < len(name) <= 4096, '无效的文件名')
    require(not re.search(r'[\\:\x00-\x1f\x7f]', name), f'文件路径含禁止字符: {name!r}')
    for part in name.split('/'):
        require(part and part not in ('.', '..') and part == part.rstrip(' .'), f'文件路径不安全: {name!r}')
        require(not re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])', part.split('.')[0], re.I), '禁止平台保留文件名')
    return name


def unique_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'JSON 键重复: {key}')
            result[key] = value
        return result
    return json.loads(raw.decode('utf-8-sig'), object_pairs_hook=pairs,
                      parse_constant=lambda value: require(False, f'JSON 含非有限数值: {value}'))


def inventory(archive, limits, max_count=None):
    entries = archive.infolist()
    require(0 < len(entries) <= (max_count or limits['memberCount']), '压缩包文件数量超出上限')
    names, total = set(), 0
    for entry in entries:
        safe_name(entry.filename)
        normalized = unicodedata.normalize('NFC', entry.filename).casefold()
        require(normalized not in names, '压缩包存在大小写或 Unicode 重名文件')
        names.add(normalized)
        mode = entry.external_attr >> 16
        require(not entry.is_dir() and stat.S_IFMT(mode) in (0, stat.S_IFREG), '压缩包包含目录、链接或特殊文件')
        require(not entry.flag_bits & 1 and entry.compress_type in (0, 8), '禁止加密或非标准压缩方式')
        require(entry.file_size <= limits['memberBytes'], '单个文件超过大小上限')
        require(entry.file_size <= max(entry.compress_size, 1) * limits['compressionRatio'], '压缩比例超过上限')
        total += entry.file_size
    require(total <= limits['expandedBytes'], '展开总大小超过上限')
    return entries


def read_limited(stream, limit):
    result = stream.read(limit + 1)
    require(len(result) <= limit, '文件超过读取上限')
    return result


def scan_pickle(raw, label):
    from picklescan.scanner import scan_pickle_bytes
    # 先自行验证完整字节流，避免第三方扫描器把无法解析的数据视为无发现
    count, end = 0, None
    for opcode, argument, offset in pickletools.genops(raw):
        count += 1
        require(count <= 2_000_000, 'Pickle 指令数量超过上限')
        require(opcode.name not in ('EXT1', 'EXT2', 'EXT4'), 'Pickle 含外部扩展注册表引用')
        if opcode.name == 'STOP':
            end = offset + 1
    require(end == len(raw), 'Pickle 缺少完整结尾或带有额外字节')
    result = scan_pickle_bytes(io.BytesIO(raw), label, multiple_pickles=False, strict=True)
    require(result.scanned_files == 1 and not result.scan_err and not result.issues_count
            and not result.infected_files and not result.suspicious_count, 'PTH 含危险、未知或无法完整扫描的对象引用')


def scan_pth(path, limits):
    require(zipfile.is_zipfile(path), '仅审核现代 ZIP 格式 PTH，旧 Pickle/Tar 请由发布者重新导出')
    with zipfile.ZipFile(path) as archive:
        entries = inventory(archive, limits)
        prefix = entries[0].filename.split('/')[0] + '/'
        has_pickle = False
        for entry in entries:
            require(entry.filename.startswith(prefix), 'PTH 顶层目录不一致')
            relative = entry.filename[len(prefix):]
            require(relative in ('data.pkl', 'byteorder', 'version', '.data/serialization_id', '.format_version', '.storage_alignment')
                    or re.fullmatch(r'data/\d+', relative), 'PTH 含额外程序、TorchScript 或未知成员')
            with archive.open(entry) as stream:
                if relative == 'data.pkl':
                    scan_pickle(read_limited(stream, limits['pickleBytes']), entry.filename)
                    has_pickle = True
                else:
                    while stream.read(1024 * 1024):
                        pass
        require(has_pickle, 'PTH 缺少 data.pkl')


def scan_npy(stream, size):
    import numpy as np
    version = np.lib.format.read_magic(stream)
    require(version in ((1, 0), (2, 0)), '不支持的 NPY 版本')
    read_header = np.lib.format.read_array_header_1_0 if version == (1, 0) else np.lib.format.read_array_header_2_0
    shape, _, dtype = read_header(stream, max_header_size=65536)
    require(not dtype.hasobject and dtype.kind in 'biufc', '语义向量含对象或非数值类型')
    require(all(isinstance(value, int) and value >= 0 for value in shape), 'NPY 形状无效')
    require(stream.tell() + math.prod(shape) * dtype.itemsize == size, 'NPY 长度与形状不一致')
    while stream.read(1024 * 1024):
        pass


def scan_onnx(path, record, root):
    import onnx
    model = onnx.load_model(path, load_external_data=False)
    require(not model.training_info, '部署模型不能附带训练图')
    expected = {f'galatea.{key}': str(record[key]) for key in (
        'model_id', 'model_prefix', 'iteration', 'model_protocol_version',
        'protocol_schema_hash', 'card_vocab_hash', 'semantic_lookup_hash')}
    metadata = {item.key: item.value for item in model.metadata_props}
    require(len(metadata) == len(model.metadata_props), 'ONNX 元数据有重复键')
    require(all(metadata.get(key) == value for key, value in expected.items()), 'ONNX 内嵌身份或协议与 GKG 清单不符')
    pending, seen = [model], 0
    while pending:
        current = pending.pop()
        seen += 1
        require(seen <= 500_000, 'ONNX 图规模超过审核上限')
        if isinstance(current, (onnx.NodeProto, onnx.FunctionProto, onnx.OperatorSetIdProto)):
            require(current.domain in ('', 'ai.onnx', 'ai.onnx.ml'), 'ONNX 含未支持的自定义运算域')
        if isinstance(current, onnx.TensorProto) and (current.external_data or current.data_location == onnx.TensorProto.EXTERNAL):
            fields = {item.key: item.value for item in current.external_data}
            require(len(fields) == len(current.external_data) and set(fields) <= {'location', 'offset', 'length', 'checksum'}, 'ONNX 外部数据参数无效')
            name = safe_name(fields.get('location', ''))
            require('/' not in name and name in record['files'] and name.endswith('.onnx.data'), 'ONNX 外部张量不在本制品声明的侧文件中')
            size = (root / name).stat().st_size
            require(re.fullmatch(r'\d+', fields.get('offset', '0')) and re.fullmatch(r'\d+', fields.get('length', str(size))), 'ONNX 外部张量范围无效')
            offset, length = int(fields.get('offset', 0)), int(fields.get('length', size))
            require(offset + length <= size, 'ONNX 外部张量超出文件范围')
        for descriptor, value in current.ListFields():
            if descriptor.message_type:
                pending.extend(value if descriptor.is_repeated else [value])
    onnx.checker.check_model(str(path), full_check=False, check_custom_domain=True)


def scan_text(path, limit, kind):
    with path.open('rb') as stream:
        raw = read_limited(stream, limit)
    text = raw.decode('utf-8-sig')
    require(not re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', text), '文本附件含二进制控制字符')
    if kind == '.json':
        unique_json(raw)
    elif kind == '.jsonl':
        for line in text.splitlines():
            if line.strip():
                unique_json(line.encode('utf-8'))
    elif kind in ('.yaml', '.yml'):
        import yaml
        # 只解析事件与安全标签，不构造 Python 对象，也不展开别名
        for event in yaml.parse(text):
            require(getattr(event, 'tag', None) in (None, 'tag:yaml.org,2002:str', 'tag:yaml.org,2002:int',
                    'tag:yaml.org,2002:float', 'tag:yaml.org,2002:bool', 'tag:yaml.org,2002:null',
                    'tag:yaml.org,2002:map', 'tag:yaml.org,2002:seq'), 'YAML 含自定义对象标签')
    elif kind == '.toml':
        import tomllib
        tomllib.loads(text)
    elif kind == '.md':
        require(not re.search(r'<\s*(script|iframe|object|embed)\b|javascript\s*:', text, re.I), '说明文档含活动内容')
    elif kind == '.ydk':
        require(all(not line.strip() or line.lstrip().startswith(('#', '!')) or line.strip().isdigit()
                    for line in text.splitlines()), 'YDK 含非卡密内容')


def inspect_package(path, policy):
    limits = policy['limits']
    require(path.stat().st_size <= limits['packageBytes'], '包体超过自动审核上限')
    with path.open('rb') as stream:
        sha = hashlib.file_digest(stream, 'sha256').hexdigest()
    with tempfile.TemporaryDirectory(prefix='gkg-review-') as temporary, zipfile.ZipFile(path) as archive:
        root = Path(temporary)
        entries = inventory(archive, limits)
        names = {entry.filename for entry in entries}
        require('manifest.json' in names, '包体缺少 manifest.json')
        with archive.open('manifest.json') as stream:
            manifest = unique_json(read_limited(stream, limits['manifestBytes']))
        require(manifest.get('package_format_version') in (4, 5) and manifest.get('model_protocol_version') == 4, '仅支持 V4 协议的 GKG4/5')
        records = manifest.get('model_artifacts', [])
        require(isinstance(records, list) and records, '缺少模型制品清单')
        model_files = set()
        for record in records:
            require(record.get('format') in ('onnx', 'pytorch_checkpoint'), '未知模型格式')
            primary = safe_name(record['primary'])
            suffix = '.onnx' if record['format'] == 'onnx' else '.pth'
            require('/' not in primary and primary.endswith(suffix), '模型主文件类型不符')
            require(primary in record['files'], '模型主文件未声明')
            for name in record['files']:
                safe_name(name)
                require('/' not in name and name.endswith(('.pth', '.onnx', '.onnx.data', '.artifacts.json')), '模型文件声明中夹带其他格式')
                model_files.add(name)
        primaries = {record['primary'] for record in records}
        require(all(not name.endswith(('.pth', '.onnx')) or name in primaries for name in model_files), '存在未经模型清单声明的权重文件')
        # Core 将制品身份旁表列在包级文件清单，不重复放入每个模型记录
        sidecars = {str(Path(name).with_suffix('.artifacts.json')) for name in primaries}
        included = manifest.get('model_files_included', list(model_files))
        require(isinstance(included, list) and len(included) <= limits['memberCount'], '包级模型文件清单无效')
        require(model_files <= set(included) <= model_files | sidecars, '包级模型文件清单包含未支持的侧文件')
        model_files.update(included)
        content_rows = manifest.get('optional_content', {}).get('files', [])
        require(manifest['package_format_version'] == 5 or not content_rows, 'GKG4 不接受共享附件')
        require(manifest['package_format_version'] == 4 or content_rows, 'GKG5 缺少共享附件')
        content = {}
        for row in content_rows:
            name, category = safe_name(row['path']), row['category']
            require(category in policy['attachments'] and name == f"content/{category}/{row['relative_path']}", '附件分类与路径不符')
            require(name not in content and any(name.lower().endswith(ext) for ext in policy['attachments'][category]), '附件类型未获准或存在重复声明')
            content[name] = row
        required = model_files | set(content) | {'manifest.json', 'card_vocab.json', 'semantic_lookup_v1.npz', 'semantic_lookup_v1.json'}
        require(required <= names and names <= required | ROOT_FILES, '包体缺失必要文件或夹带未声明文件')
        files = []
        for entry in entries:
            name = entry.filename
            # 原始 ZIP 路径不直接用于附件落盘，避免覆盖审核器文件
            target = root / name if '/' not in name else root / f'attachment-{len(files)}'
            size, checksum = 0, hashlib.sha256()
            with archive.open(entry) as source, target.open('xb') as output:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    require(size <= entry.file_size and size <= limits['memberBytes'], '解压大小超过声明')
                    checksum.update(chunk)
                    output.write(chunk)
            require(size == entry.file_size, '文件实际大小与目录不符')
            value = checksum.hexdigest()
            if name in content:
                require(content[name]['size'] == size and content[name]['sha256'] == value, '附件摘要与清单不符')
            kind = Path(name).suffix.lower()
            if kind == '.json':
                limit = limits['manifestBytes'] if name == 'manifest.json' else limits['jsonBytes'] if name in ROOT_FILES else limits['textBytes']
                scan_text(target, limit, kind)
            elif kind == '.npy':
                with target.open('rb') as stream:
                    scan_npy(stream, size)
            elif kind == '.npz':
                with zipfile.ZipFile(target) as vectors:
                    for member in inventory(vectors, limits, 256):
                        require(member.filename.endswith('.npy') and '/' not in member.filename, 'NPZ 含非数组成员')
                        with vectors.open(member) as stream:
                            scan_npy(stream, member.file_size)
            elif name in content:
                if kind in ('.png', '.jpg', '.jpeg', '.gif', '.webp'):
                    from PIL import Image
                    Image.MAX_IMAGE_PIXELS = 20_000_000
                    with Image.open(target) as image:
                        require(image.width * image.height <= Image.MAX_IMAGE_PIXELS, '图片尺寸过大')
                        image.verify()
                elif name.lower().endswith('.jsonl.gz'):
                    with gzip.open(target, 'rb') as stream:
                        raw = read_limited(stream, limits['textBytes'])
                    for line in raw.splitlines():
                        if line.strip():
                            unique_json(line)
                elif kind.startswith('.yrp'):
                    with target.open('rb') as stream:
                        require(stream.read(3) in (b'yrp', b'YRP'), '录像缺少 YRP 标记')
                else:
                    scan_text(target, limits['textBytes'], kind)
            files.append({'path': name, 'sizeBytes': size, 'sha256': value})
        for record in records:
            target = root / record['primary']
            if record['format'] == 'onnx':
                scan_onnx(target, record, root)
            else:
                scan_pth(target, limits)
    return {'schemaVersion': 1, 'status': 'passed', 'sha256': sha, 'sizeBytes': path.stat().st_size,
            'checks': ['zip-inventory-crc', 'member-hashes', 'attachment-types', 'numpy-no-objects', 'onnx-static', 'pth-pickle-static'],
            'files': files, 'limitations': ['No model execution or gameplay evaluation', 'No guarantee against training-data poisoning or unknown parser vulnerabilities']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('package')
    parser.add_argument('policy')
    parser.add_argument('output')
    args = parser.parse_args()
    try:
        report = inspect_package(Path(args.package), unique_json(Path(args.policy).read_bytes()))
    except Exception as error:
        report = {'schemaVersion': 1, 'status': 'blocked', 'error': str(error)}
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'files'}, ensure_ascii=True))
    raise SystemExit(0 if report['status'] == 'passed' else 1)
