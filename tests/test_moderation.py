import copy
import hashlib
import importlib.util
import io
import json
import pickle
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inspect_package', ROOT / 'scripts/moderation/inspect_package.py')
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)
POLICY = json.loads((ROOT / 'registry/moderation-policy.json').read_text(encoding='utf-8'))


def fixture():
    primary = 'galatea_iter_200.onnx'
    record = {'model_id': '6d1b2471-1ab3-4c5a-b678-760568497127', 'model_prefix': 'galatea',
              'iteration': 200, 'model_protocol_version': 4, 'protocol_schema_hash': 'a' * 64,
              'card_vocab_hash': 'b' * 64, 'semantic_lookup_hash': 'c' * 64,
              'format': 'onnx', 'primary': primary, 'files': [primary], 'status': 'complete'}
    graph = helper.make_graph([helper.make_node('Identity', ['x'], ['y'])], 'fixture',
                             [helper.make_tensor_value_info('x', TensorProto.FLOAT, [1])],
                             [helper.make_tensor_value_info('y', TensorProto.FLOAT, [1])])
    model = helper.make_model(graph)
    helper.set_model_props(model, {f'galatea.{key}': str(record[key]) for key in (
        'model_id', 'model_prefix', 'iteration', 'model_protocol_version', 'protocol_schema_hash', 'card_vocab_hash', 'semantic_lookup_hash')})
    arrays = io.BytesIO()
    np.savez(arrays, test=np.array([1.0], dtype=np.float32))
    manifest = {'package_format_version': 4, 'model_protocol_version': 4, 'model_artifacts': [record]}
    files = {primary: model.SerializeToString(), 'card_vocab.json': b'{}',
             'semantic_lookup_v1.json': b'{}', 'semantic_lookup_v1.npz': arrays.getvalue()}
    return manifest, files


def add_content(manifest, files, name, content, category='documents'):
    manifest['package_format_version'] = 5
    full = f'content/{category}/{name}'
    manifest.setdefault('optional_content', {'format_version': 1, 'files': []})['files'].append({
        'category': category, 'path': full, 'relative_path': name, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    files[full] = content


class ModerationTests(unittest.TestCase):
    def inspect(self, manifest, files, policy=None, extras=()):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.gkg'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('manifest.json', json.dumps(manifest))
                for name, raw in files.items():
                    archive.writestr(name, raw)
                for name, raw in extras:
                    archive.writestr(name, raw)
            return scanner.inspect_package(path, policy or POLICY)

    def test_gkg4_and_gkg5(self):
        manifest, files = fixture()
        self.assertEqual(self.inspect(manifest, files)['status'], 'passed')
        add_content(manifest, files, '说明.md', '# 使用说明'.encode())
        self.assertEqual(self.inspect(manifest, files)['status'], 'passed')

    def test_core_package_level_artifact_sidecar(self):
        manifest, files = fixture()
        name = str(Path(manifest['model_artifacts'][0]['primary']).with_suffix('.artifacts.json'))
        files[name] = b'{"format_version":3}'
        manifest['model_files_included'] = [manifest['model_artifacts'][0]['primary'], name]
        self.assertEqual(self.inspect(manifest, files)['status'], 'passed')
        manifest['model_files_included'].append('other.onnx')
        files['other.onnx'] = b'unknown'
        with self.assertRaisesRegex(ValueError, '侧文件'):
            self.inspect(manifest, files)

    def test_path_and_case_collisions(self):
        for path in ('../escape', '/absolute', 'x\\escape', 'con.txt', 'name.', 'NAME.json'):
            manifest, files = fixture()
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.inspect(manifest, files, extras=[('name.json', b'{}'), (path, b'{}')])

    def test_symlink(self):
        manifest, files = fixture()
        info = zipfile.ZipInfo('link')
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaisesRegex(ValueError, '链接'):
            self.inspect(manifest, files, extras=[(info, b'/etc/passwd')])

    def test_undeclared_and_executable(self):
        manifest, files = fixture()
        with self.assertRaises(ValueError):
            self.inspect(manifest, files, extras=[('install.sh', b'echo unwanted')])
        add_content(manifest, files, 'install.exe', b'MZ')
        with self.assertRaisesRegex(ValueError, '类型'):
            self.inspect(manifest, files)

    def test_bad_hash_and_unsupported_document(self):
        manifest, files = fixture()
        add_content(manifest, files, '说明.md', b'hello')
        files['content/documents/说明.md'] = b'other'
        with self.assertRaisesRegex(ValueError, '摘要'):
            self.inspect(manifest, files)
        manifest, files = fixture()
        add_content(manifest, files, 'active.svg', b'<svg/>')
        with self.assertRaisesRegex(ValueError, '类型'):
            self.inspect(manifest, files)

    def test_member_limits_and_bomb(self):
        manifest, files = fixture()
        policy = copy.deepcopy(POLICY)
        policy['limits']['memberBytes'] = 100
        with self.assertRaisesRegex(ValueError, '大小上限'):
            self.inspect(manifest, files, policy)
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('zeros', b'0' * 4_000_000)
        with zipfile.ZipFile(io.BytesIO(data.getvalue())) as archive, self.assertRaisesRegex(ValueError, '压缩比例'):
            scanner.inventory(archive, POLICY['limits'])

    def test_pickle_is_never_executed(self):
        scanner.scan_pickle(pickle.dumps({'data': [1, 2, 3]}), 'safe')
        # 只含危险调用引用的静态字节，不含可执行载荷，也不调用反序列化
        with self.assertRaisesRegex(ValueError, '危险'):
            scanner.scan_pickle(b'cbuiltins\neval\n.', 'unsafe')
        for raw in (b'not a pickle', pickle.dumps(1) + b'junk', b'\x80\x02\x82\x01.'):
            with self.assertRaises(ValueError):
                scanner.scan_pickle(raw, 'malformed')

    def test_pth_container_scans_pickle_and_rejects_code(self):
        manifest, files = fixture()
        old = manifest['model_artifacts'][0]['primary']
        files.pop(old)
        record = manifest['model_artifacts'][0]
        record.update(format='pytorch_checkpoint', primary='model.pth', files=['model.pth'])
        for executable in (False, True):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w') as archive:
                archive.writestr('archive/data.pkl', pickle.dumps({'weights': [1, 2]}))
                if executable:
                    archive.writestr('archive/code/script.py', b'pass')
            files['model.pth'] = buf.getvalue()
            if executable:
                with self.assertRaisesRegex(ValueError, '程序'):
                    self.inspect(manifest, files)
            else:
                self.assertEqual(self.inspect(manifest, files)['status'], 'passed')

    def test_numpy_object_rejected(self):
        manifest, files = fixture()
        buf = io.BytesIO()
        np.savez(buf, test=np.array([{'a': 1}], dtype=object))
        files['semantic_lookup_v1.npz'] = buf.getvalue()
        with self.assertRaisesRegex(ValueError, '对象'):
            self.inspect(manifest, files)

    def test_onnx_metadata_and_external_path(self):
        manifest, files = fixture()
        record = manifest['model_artifacts'][0]
        model = onnx.load_model_from_string(files[record['primary']])
        model.metadata_props[0].value = 'wrong identity'
        files[record['primary']] = model.SerializeToString()
        with self.assertRaisesRegex(ValueError, '身份'):
            self.inspect(manifest, files)
        manifest, files = fixture()
        record = manifest['model_artifacts'][0]
        model = onnx.load_model_from_string(files[record['primary']])
        tensor = model.graph.initializer.add()
        tensor.name, tensor.data_type = 'outside', TensorProto.FLOAT
        tensor.dims.append(1)
        tensor.data_location = TensorProto.EXTERNAL
        entry = tensor.external_data.add()
        entry.key, entry.value = 'location', '../outside'
        files[record['primary']] = model.SerializeToString()
        with self.assertRaisesRegex(ValueError, '路径'):
            self.inspect(manifest, files)

    def test_yaml_tag_and_active_markdown(self):
        for name, raw, category in [('settings.yml', b'!!python/object/apply:os.system []', 'presets'),
                                    ('readme.md', b'<script>alert(1)</script>', 'documents')]:
            manifest, files = fixture()
            add_content(manifest, files, name, raw, category)
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.inspect(manifest, files)

    def test_duplicate_json_keys_rejected(self):
        with self.assertRaisesRegex(ValueError, '重复'):
            scanner.unique_json(b'{"permission":false,"permission":true}')


if __name__ == '__main__':
    unittest.main()
