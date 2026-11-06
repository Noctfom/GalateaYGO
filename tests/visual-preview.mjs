import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
await mkdir('test-results', {recursive:true});
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
const errors=[];
const baseURL=process.env.PLAYWRIGHT_BASE_URL||'http://127.0.0.1:4321';
page.on('pageerror',error=>errors.push(error.message));
for (const [route,name] of [['/zh/','home'],['/zh/models/','models'],['/zh/models/example-general/','detail'],['/zh/publish/','publish']]) {
  await page.goto(`${baseURL}${route}`);
  await page.screenshot({path:`test-results/${name}.png`,fullPage:true});
}
await page.setViewportSize({width:375,height:900});
await page.goto(`${baseURL}/zh/`);
await page.screenshot({path:'test-results/home-mobile.png',fullPage:true});
console.log(JSON.stringify({errors,overflow:await page.evaluate(()=>[...document.querySelectorAll('body *')].map(el=>({tag:el.tagName,class:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right})).filter(el=>el.right>window.innerWidth+1||el.left< -1))},null,2));
await browser.close();
