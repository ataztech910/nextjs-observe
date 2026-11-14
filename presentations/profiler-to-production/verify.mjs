import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE_ROOT ? resolve(process.env.PLAYWRIGHT_PACKAGE_ROOT, 'package.json') : fileURLToPath(new URL('../../../performance-observability/package.json', import.meta.url));
const {chromium}=createRequire(playwrightPackage)('playwright');
const out=resolve(process.env.DECK_ARTIFACTS ?? fileURLToPath(new URL('artifacts',import.meta.url)));await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],requests=[],results=[];
try {
const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(String(e)));page.on('request',r=>requests.push(r.url()));
const base=process.env.DECK_URL ?? 'http://127.0.0.1:4348/presentations/profiler-to-production/index.html';
await page.goto(base);
for(const id of ['01','02','03','04','05','06','07','08','A1','A2']){
 await page.goto(base+'#slide-'+id);await page.waitForFunction(id=>!document.querySelector('#slide-'+id).hidden,id);
 const metrics=await page.locator('#slide-'+id).evaluate(slide=>{const box=slide.querySelector('.paper').getBoundingClientRect(),footer=slide.querySelector('footer').getBoundingClientRect(),content=slide.querySelector('.copy').getBoundingClientRect();return {id:slide.id,contentBottom:content.bottom,footerTop:footer.top,overlap:content.bottom>footer.top-8,horizontal:slide.querySelector('.paper').scrollWidth>box.width+1,visibleNotes:!slide.querySelector('.speaker').hidden};});
 if(metrics.overlap||metrics.horizontal||metrics.visibleNotes)throw Error('Layout '+JSON.stringify(metrics));
 results.push(metrics);await page.screenshot({path:out+'/'+id+'.png'});
}
await page.goto(base);await page.keyboard.press('ArrowRight');await page.waitForURL('**#slide-02');
await page.keyboard.press('n');if(!await page.getByRole('heading',{name:'Speaker notes · 02',exact:true}).isVisible())throw Error('Notes toggle');
await page.keyboard.press('Escape');if(await page.getByRole('heading',{name:'Speaker notes · 02',exact:true}).isVisible())throw Error('Notes escape');
await page.keyboard.press('o');await page.getByRole('dialog').waitFor();await page.locator('[data-slide="07"]').click();await page.waitForURL('**#slide-07');
await page.keyboard.press('End');await page.waitForURL('**#slide-A2');await page.waitForFunction(()=>document.querySelector('#next').disabled);if(!await page.getByRole('button',{name:'Next slide',exact:true}).isDisabled())throw Error('End bound');
await page.keyboard.press('Home');await page.waitForURL('**#slide-01');await page.waitForFunction(()=>document.querySelector('#previous').disabled);if(!await page.getByRole('button',{name:'Previous slide',exact:true}).isDisabled())throw Error('Start bound');
await page.goBack();await page.waitForFunction(()=>!document.querySelector('#slide-A2').hidden);
await page.goto(base+'#invalid');if(!await page.locator('#slide-01').isVisible())throw Error('Bad hash fallback');
await page.setViewportSize({width:1280,height:720});await page.goto(base+'#slide-07');if(await page.getByRole('button',{name:'Print / PDF'}).evaluate(el=>el.getBoundingClientRect().bottom>innerHeight))throw Error('Short viewport controls');
await page.setViewportSize({width:390,height:844});await page.goto(base+'#slide-04');if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow');await page.screenshot({path:out+'/mobile.png'});
await page.setViewportSize({width:1440,height:900});await page.goto(base+'#slide-07');await page.keyboard.press('n');await page.emulateMedia({media:'print'});
if(await page.locator('.slide:visible').count()!==10||await page.locator('.speaker:visible').count()!==0||await page.locator('.controls:visible').count()!==0)throw Error('Print audience isolation');
await page.pdf({path:out+'/profiler-to-production.pdf',preferCSSPageSize:true,printBackground:true});
await page.emulateMedia({media:'screen'});
const file=new URL('index.html',import.meta.url).href;
const before=requests.length;await page.context().setOffline(true);await page.goto(file+'#slide-06');await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>!document.querySelector('#slide-07').hidden);const offlineRequests=requests.slice(before).filter(url=>/^https?:/.test(url));if(offlineRequests.length)throw Error('Offline network dependency');
if(errors.length)throw Error('Browser errors '+errors);
await writeFile(out+'/verification.json',JSON.stringify({slides:results,errors,offlineNetworkRequests:offlineRequests,checks:['navigation','deep links','history','invalid hash','notes toggle/escape','overview selection','bounds','720p controls','mobile overflow','print isolation','offline file'],pdf:out+'/profiler-to-production.pdf'},null,2));
console.log(JSON.stringify({out,slides:results.length,errors,pdf:out+'/profiler-to-production.pdf'}));
}finally{await browser.close();}
