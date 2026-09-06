const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=path.join(__dirname,'..'),index=fs.readFileSync(path.join(root,'index.html'),'utf8');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:390,height:300}});
  const requested=[];
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>@font-face{font-family:'Noto Sans Old Hangul';src:url('/assets/fonts/NotoSansOldHangul-Regular.woff2') format('woff2');font-weight:400}@font-face{font-family:'Noto Sans Old Hangul';src:url('/assets/fonts/NotoSansOldHangul-Bold.woff2') format('woff2');font-weight:700 900}.old-hangul{font-family:'Noto Sans Old Hangul',sans-serif;font-feature-settings:'ccmp' 1,'ljmo' 1,'vjmo' 1,'tjmo' 1}</style><div class="old-hangul" style="font-size:30px">ᄀᆞᅀᆞᆯ · 바ᄅᆞᆯ · ᄆᆞᅀᆞᆷ</div><b class="old-hangul" style="font-size:30px">ᄒᆞᆫᄃᆡ</b>`});
   const name=path.basename(url.pathname),file=path.join(root,'assets','fonts',name);
   if(fs.existsSync(file)){requested.push(name);return route.fulfill({contentType:'font/woff2',body:fs.readFileSync(file)});}
   return route.abort();
  });
  await page.goto('http://localhost/');
  await page.evaluate(()=>document.fonts.ready);
  assert.match(index,/Noto Sans Old Hangul/);
  assert.equal(await page.evaluate(()=>document.fonts.check('400 30px "Noto Sans Old Hangul"','ᄀᆞᅀᆞᆯ')),true);
  assert.equal(await page.evaluate(()=>document.fonts.check('800 30px "Noto Sans Old Hangul"','ᄒᆞᆫᄃᆡ')),true);
  assert.deepEqual(requested.sort(),['NotoSansOldHangul-Bold.woff2','NotoSansOldHangul-Regular.woff2']);
  console.log('PASS: old Hangul regular/bold fonts load for conjoining Jamo text');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
