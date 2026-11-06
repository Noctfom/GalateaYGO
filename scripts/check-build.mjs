import { readdir,readFile,stat } from 'node:fs/promises';
import { resolve,join,extname } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve('dist');
const demo=process.argv.includes('--demo');
async function walk(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)]))).flat();}
const files=await walk(root);
const errors=[];
const exists=async file=>{try{await stat(file);return true;}catch{return false;}};
for(const file of files.filter(file=>extname(file)==='.html')){
  const html=await readFile(file,'utf8');
  for(const match of html.matchAll(/(?:href|src)="(\/[^"\s]*)"/g)){
    const target=new URL(match[1],'https://galateaygo.invalid');
    const pathname=decodeURIComponent(target.pathname);
    const candidate=join(root,pathname.replace(/^\//,''));
    if(!await exists(candidate)&&!await exists(join(candidate,'index.html')))errors.push(`${file}: ${pathname}`);
  }
  if(!demo&&html.includes('data-favorite="preview-'))errors.push(`${file}: 正式站点泄漏示例条目`);
}
const registry=JSON.parse(await readFile(join(root,'catalog/v1.json'),'utf8'));
assert.ok(registry.models.every(model=>!model.example),'公共目录不能包含示例模型');
assert.equal(await exists(join(root,'zh/models/example-general/index.html')),demo,'示例路由只存在于演示构建');
assert.equal(errors.length,0,errors.join('\n'));
console.log(`静态站点验证通过：${files.length} 个文件，无断开的站内链接；构建模式 ${demo?'演示':'正式'}`);
