import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
const playwrightPackage=process.env.PLAYWRIGHT_PACKAGE_ROOT?resolve(process.env.PLAYWRIGHT_PACKAGE_ROOT,'package.json'):fileURLToPath(new URL('../../../../performance-observability/package.json',import.meta.url));
const {chromium}=createRequire(playwrightPackage)('playwright');
const out=resolve(process.env.DECK_ARTIFACTS??fileURLToPath(new URL('artifacts',import.meta.url)));
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],external=[],results=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>{if(/^https?:/.test(r.url())&&!/^http:\/\/127\.0\.0\.1:/.test(r.url()))external.push(r.url());});
 const base=process.env.DECK_URL??'http://127.0.0.1:4349/';
 async function ready(id){
  await page.waitForFunction(id=>new URLSearchParams(location.hash.slice(1)).get('step')===id,id);
  await page.locator('.node-card--focus li').first().waitFor();
  await page.waitForFunction(()=>{const items=[...document.querySelectorAll('.node-card--focus li')];return items.length>0&&items.every(el=>Number(getComputedStyle(el).opacity)>.99)&&document.querySelector('.node-card--focus ul').getBoundingClientRect().height>30;});
  await page.waitForFunction(()=>{const node=document.querySelector('.node-card--focus'),canvas=document.querySelector('.canvas-viewport');if(!node||!canvas)return false;const n=node.getBoundingClientRect(),c=canvas.getBoundingClientRect();return n.width>100&&n.left>=c.left-2&&n.right<=c.right+2&&n.top>=c.top-2&&n.bottom<=c.bottom+2;});
 }
 await page.goto(base);await ready('slide-01');
 if(await page.locator('#world').count()!==1||await page.locator('.node-card').count()!==12)throw Error('Not the original canvas engine');
 const initial=await page.locator('#world').getAttribute('style');
 for(const id of ['01','about-me','gdg-linz','02','03','04','05','06','07','08']){
  if(id!=='01'){await page.keyboard.press('ArrowRight');await ready(['about-me','gdg-linz'].includes(id)?id:'slide-'+id);}
  const text=await page.locator('.node-card--focus').innerText();
  if(text.includes('Timing:')||await page.getByRole('complementary',{name:'Presenter notes',exact:true}).count())throw Error('Notes leaked');
  if(['about-me','gdg-linz'].includes(id)){const image=page.locator('.node-card--focus img.photo-frame').first();await image.waitFor();await image.evaluate(img=>img.decode());if(!await image.evaluate(img=>img.naturalWidth>0))throw Error('Intro image missing');if(id==='gdg-linz'&&await image.evaluate(img=>getComputedStyle(img).objectFit)!=='contain')throw Error('GDG logo cropped');}
  results.push({id,text});await page.screenshot({path:out+'/'+id+'.png'});
 }
 if(await page.locator('#world').getAttribute('style')===initial)throw Error('Camera did not move');
 await page.keyboard.press('ArrowRight');await page.waitForTimeout(150);if(!page.url().endsWith('#step=slide-08'))throw Error('Main route entered appendix automatically');
 await page.keyboard.press('n');const notes=page.getByRole('complementary',{name:'Presenter notes',exact:true});await notes.waitFor();if(!await notes.innerText().then(t=>t.includes('23:00–25:00')))throw Error('Timing note missing');
 const noteBounds=await notes.boundingBox();if(noteBounds.y<0||noteBounds.y+noteBounds.height>900)throw Error('Notes outside viewport');
 await page.keyboard.press('n');await notes.waitFor({state:'hidden'});
 await page.keyboard.press('o');await page.getByText('Overview — click any card to jump',{exact:true}).waitFor();
 await page.getByRole('button',{name:/^React Native: callback cadence is one observable/}).click();await ready('slide-A1');
 if(!await page.locator('.node-card--focus').innerText().then(t=>t.includes('unavailable in the retained Simulator hitch probe')))throw Error('Native boundary lost');
 await page.screenshot({path:out+'/A1.png'});await page.keyboard.press('ArrowRight');await ready('slide-08');
 await page.keyboard.press('o');await page.getByText('Overview — click any card to jump',{exact:true}).waitFor();await page.getByRole('button',{name:/^Runner outcome and archive state are separate/}).click();await ready('slide-A2');if(!await page.locator('.node-card--focus').innerText().then(t=>t.includes('failed')&&t.includes('finalized')))throw Error('Runner/archive distinction lost');await page.screenshot({path:out+'/A2.png'});await page.keyboard.press('ArrowRight');await ready('slide-08');
 await page.keyboard.press('Home');await ready('slide-01');
 await page.keyboard.press('?');await page.getByRole('dialog',{name:'Keyboard shortcuts'}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'Keyboard shortcuts'}).waitFor({state:'hidden'});
 await page.goto(base+'#step=slide-07');await page.reload();await ready('slide-07');
 if(!await page.locator('.node-card--focus').innerText().then(t=>t.includes('1871 B')&&t.includes('8275 B')&&t.includes('+21.433 ms [1.450, 44.650]')))throw Error('Cost evidence lost: '+await page.locator('.node-card--focus').innerText());
 await page.setViewportSize({width:1280,height:720});await ready('slide-07');await page.screenshot({path:out+'/720p.png'});
 await page.context().setOffline(true);
 const packed=process.env.DECK_PACKED_URL??new URL('dist/index.html',import.meta.url).href;
 await page.goto(packed+'#step=slide-06');await page.reload();await ready('slide-06');
 if(!await page.locator('.node-card--focus').innerText().then(t=>t.includes('20 dropped spans')&&t.includes('incomplete')&&t.includes('failed')))throw Error('Packed fault states lost');
 await page.screenshot({path:out+'/offline.png'});await page.keyboard.press('Home');await ready('slide-01');for(const intro of ['about-me','gdg-linz']){await page.keyboard.press('ArrowRight');await ready(intro);const img=page.locator('.node-card--focus img.photo-frame').first();await img.evaluate(el=>el.decode());if(!await img.evaluate(el=>el.src.startsWith('data:image/jpeg;')&&el.naturalWidth>0))throw Error('Offline photo dependency');await page.screenshot({path:out+'/offline-'+intro+'.png'});}await page.goto(packed+'?reload=1#step=slide-06');await ready('slide-06');await page.keyboard.press('ArrowRight');await ready('slide-07');
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));
 await writeFile(out+'/verification.json',JSON.stringify({engine:'copied workshop-slides graph engine',results,errors,external,offlinePacked:packed,checks:['canvas/cards','camera','intro photos/QR/offline images','main route stop','notes/scroll','both overview appendices/return','home','help','deep link','720p fit','offline packed fault states/navigation']},null,2));
 console.log(JSON.stringify({out,mainSlides:10,totalCards:12,errors,external,offlinePacked:packed}));
}finally{await browser.close();}
