import {readFileSync,writeFileSync} from 'node:fs';
const css=readFileSync('dist/engine.css','utf8');
const js=readFileSync('dist/engine.js','utf8');
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>From Profiler to Production</title><style>${css.replaceAll('</style','<\\/style')}</style></head><body><div id="root"></div><script>${js.replaceAll('</script','<\\/script')}</script></body></html>`;
writeFileSync('dist/index.html',html);
console.log('Packed standalone graph deck: dist/index.html');
