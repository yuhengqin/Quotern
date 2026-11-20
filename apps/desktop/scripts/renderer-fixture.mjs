// Browser-level contract tests supply synthetic data to the same bridge as the native renderer.
// Native lifecycle, window hit testing and sidecar IPC are exercised by tauri-webview-smoke.mjs.
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const switches = new Map(), paths = new Map(), handlers = new Map();
const contexts = new Map(), windows = new Set(), byPage = new Map();
const events = new EventEmitter();
let browser, bridge, clipboardText = '', closing, rendererServer, rendererOrigin;
export const fixtureClipboard = { readText: () => clipboardText, clear() { clipboardText = ''; } };
export const fixtureIpc = {
  handle(channel,handler) { if(handlers.has(channel)) throw Error('Duplicate fixture handler '+channel); handlers.set(channel,handler); },
  removeHandler: channel => handlers.delete(channel),
  on: (...args) => events.on(...args),
  removeListener: (...args) => events.removeListener(...args),
};
async function start() {
  const profile = paths.get('userData');
  if (!profile || !path.isAbsolute(profile)) throw Error('A dedicated fixture profile is required');
  await mkdir(profile,{recursive:true});
  const dist = path.join(desktopRoot, 'out', 'renderer');
  const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png','.json':'application/json'};
  rendererServer = createServer(async (request,response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(dist, '.' + (pathname==='/' ? '/index.html' : pathname));
      if (!file.startsWith(dist+path.sep)) {response.writeHead(403).end();return;}
      response.writeHead(200, {'content-type':mime[path.extname(file)]||'application/octet-stream'}).end(await readFile(file));
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => rendererServer.listen(0,'127.0.0.1',resolve));
  rendererOrigin = 'http://127.0.0.1:'+rendererServer.address().port;
  bridge = (await build({absWorkingDir:desktopRoot, bundle:true,platform:'browser',format:'iife',write:false,
    stdin:{resolveDir:desktopRoot,contents:`
      import {createTudApi} from './src/preload/index.ts';
      const listeners=new Map();
      window.__fixtureEvent=(channel,...args)=>listeners.get(channel)?.forEach(listener=>listener(undefined,...args));
      const transport={
        invoke:(channel,...args)=>window.__quoternFixtureCall(channel,args,false),
        send:(channel,...args)=>{ void window.__quoternFixtureCall(channel,args,true).catch(console.error); },
        on(channel,listener){if(!listeners.has(channel))listeners.set(channel,new Set());listeners.get(channel).add(listener);},
        removeListener(channel,listener){listeners.get(channel)?.delete(listener);}
      };
      window.tud=createTudApi(transport,${JSON.stringify(process.platform)});
    `}})).outputFiles[0].text;
  const executablePath = process.env.QUOTERN_TEST_BROWSER_EXECUTABLE;
  browser = await chromium.launch({
    ...(executablePath ? {executablePath} : process.platform==='win32' ? {channel:'msedge'} : {}),
    headless:true,downloadsPath:path.join(profile,'downloads'),
    args:['--remote-debugging-port='+switches.get('remote-debugging-port'),'--remote-debugging-address=127.0.0.1','--allow-file-access-from-files','--disable-background-timer-throttling','--disable-renderer-backgrounding'],
  });
}
export const fixtureApp = Object.assign(new EventEmitter(),{
  getPath(key) {return paths.get(key);}, setPath(key,value) {paths.set(key,value);},
  commandLine:{appendSwitch(key,value) {switches.set(key,value);}},
  whenReady:start,
  async exit(code) {
    if (!closing) closing = (async()=>{try {await browser?.close();rendererServer?.close();} finally {process.exit(code);}})();
    return closing;
  },
});
async function makeContext(desktop) {
  const context = await browser.newContext({acceptDownloads:true,locale:switches.get('lang') || 'en-US',viewport:{width:1120,height:900}});
  await context.exposeBinding('__quoternClipboard',(_source,value)=>{
    if(typeof value==='string')clipboardText=value;
    return clipboardText;
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator,'clipboard',{value:{
      writeText:value=>window.__quoternClipboard(value),readText:()=>window.__quoternClipboard(),
    },configurable:true});
  });
  if(desktop) {
    await context.exposeBinding('__quoternFixtureCall',async ({page},channel,args,send)=>{
      const window=byPage.get(page);
      if (!window) throw Error('Missing fixture window');
      const event={sender:window.webContents};
      if(handlers.has(channel)) return handlers.get(channel)(event,...args);
      if(events.listenerCount(channel)) { events.emit(channel,event,...args); return; }
      if (channel==='window:close') {setImmediate(()=>window.destroy());return;}
      if (channel==='window:minimize') {await window.setWindowState('minimized');return;}
      if (channel==='window:toggle-maximize') {await window.setWindowState(window.isMaximized()?'normal':'maximized');return;}
      if (channel==='appearance:watch-visibility') {window.watchVisibility(true);return;}
      if (channel==='appearance:unwatch-visibility') {window.watchVisibility(false);return;}
      if (!send) throw Error('No fixture handler for '+channel);
    });
    await context.addInitScript({content:bridge});
  }
  return context;
}
function contextFor(isDesktop) {
  if (!contexts.has(isDesktop)) contexts.set(isDesktop,makeContext(isDesktop));
  return contexts.get(isDesktop);
}
export function fixtureReferenceTheme(window,theme) {
  window.background=theme==='dark'?'#050607':'#f5f5f5';
  for (const child of window.references) fixtureReferenceTheme(child,theme);
}
function pngBuffer(data) {return {toPNG:()=>data,isEmpty:()=>!data?.length,getSize:()=>({width:data.readUInt32BE(16),height:data.readUInt32BE(20)})};}
export const fixtureImage={
  createFromDataURL:value=>pngBuffer(Buffer.from(value.slice(value.indexOf(',')+1),'base64')),
  createFromPath:file=>pngBuffer(readFileSync(file)),
};
export const fixtureTheme={
  themeSource:'light',get shouldUseDarkColors(){return this.themeSource==='dark';},
};
export class FixtureWindow extends EventEmitter {
  static getAllWindows(){return [...windows].filter(window=>!window.isDestroyed());}
  constructor({width=1120,height=900,desktop=false,show=true}={}) {
    super(); this.desktop=desktop;this.size=[width,height];this.references=new Set();
    this.visible=show;this.background='#f5f5f5';this.mode='normal';this.destroyed=false;
    this.webContents=Object.assign(new EventEmitter(),{
      session:new EventEmitter(), getURL:()=>this.page?.url()||'',
      insertCSS:content=>this.page.addStyleTag({content}),invalidate(){},
      capturePage:async clip=>pngBuffer(await this.page.screenshot(clip?{clip}:{})),
      send:(channel,...args)=>{ if(!this.isDestroyed())void this.page?.evaluate(([channel,...args])=>window.__fixtureEvent?.(channel,...args),[channel,...args]).catch(()=>{}); },
    });
    this.webContents.isLoading=()=>Boolean(this.loading);
    this.webContents.setBackgroundThrottling=()=>{};
    this.webContents.sendInputEvent=({type,keyCode})=>{
      this.webContents.emit('before-input-event',{}, {type,key:keyCode});
      return type==='keyDown' ? this.page.keyboard.down(keyCode) : this.page.keyboard.up(keyCode);
    };
    windows.add(this);this.id=++FixtureWindow.sequence;
    fixtureApp.emit('browser-window-created',{},this);
  }
  static sequence=0;
  watchVisibility(watch){
    if (watch && !this.publishVisibility) {
      this.publishVisibility=()=>this.webContents.send('appearance:visibility',this.isVisible()&&!this.isMinimized());
      for(const event of ['show','hide','minimize','restore'])this.on(event,this.publishVisibility);
    } else if(!watch && this.publishVisibility){
      for(const event of ['show','hide','minimize','restore'])this.off(event,this.publishVisibility);
      this.publishVisibility=undefined;
    }
    if(watch)this.publishVisibility();
  }
  async attach(page) {
    this.page=page;byPage.set(page,this);
    page.on('close',()=>{this.destroyed=true;windows.delete(this);byPage.delete(page);this.emit('closed');});
    page.on('download', async download=>{
      const item=Object.assign(new EventEmitter(),{setSavePath(value){this.file=value;},getFilename:()=>download.suggestedFilename()});
      this.webContents.session.emit('will-download',{},item,this.webContents);
      if(item.file){try{await download.saveAs(item.file);item.emit('done',{},'completed');}catch{item.emit('done',{},'interrupted');}}
    });
    page.on('popup',async popup=>{
      const child=new FixtureWindow({desktop:this.desktop,width:this.size[0],height:this.size[1]});
      child.background=this.background;this.references.add(child);
      try {await child.attach(popup);await popup.waitForLoadState('domcontentloaded');this.webContents.emit('did-create-window',child);}
      catch(error){if(!popup.isClosed())throw error;}
    });
    await page.setViewportSize({width:this.size[0],height:this.size[1]});
  }
  async loadURL(url) {
    if (!this.page) await this.attach(await (await contextFor(this.desktop)).newPage());
    this.loading=true;
    try{await this.page.goto(url,{waitUntil:'domcontentloaded'});}finally{this.loading=false;}
    this.emit('ready-to-show');
  }
  reload(){return this.page.reload({waitUntil:'domcontentloaded'});}
  loadFile(file,{hash,query}={}) {
    const relative=path.relative(path.join(desktopRoot,'out/renderer'),file).split(path.sep).join('/');
    if(relative.startsWith('..') || path.isAbsolute(relative))throw Error('File outside the fixture renderer');
    const url=new URL(relative,rendererOrigin+'/');if(query)url.search=new URLSearchParams(query).toString();if(hash)url.hash=hash;
    return this.loadURL(url.href);
  }
  getSize(){return this.size.slice();}
  getBounds(){return {width:this.size[0],height:this.size[1],x:0,y:0};}
  setSize(width,height){this.size=[width,height];return this.page?.setViewportSize({width,height});}
  getBackgroundColor(){return this.background;}
  isDestroyed(){return this.destroyed||Boolean(this.page?.isClosed());}
  isMaximized(){return this.mode==='maximized';} isMinimized(){return this.mode==='minimized';}
  async setWindowState(state){
    if(this.isDestroyed())return;
    const session=await this.page.context().newCDPSession(this.page);
    try {
      const {windowId}=await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:state}});
      this.mode=(await session.send('Browser.getWindowBounds',{windowId})).bounds.windowState;
      this.emit(state==='minimized'?'minimize':'restore');
    } catch (error) {if(!this.page.isClosed()) throw error;}
    finally {await session.detach().catch(()=>{});}
  }
  unmaximize(){return this.setWindowState('normal').catch(error=>{if(!this.isDestroyed())throw error;});}
  restore(){return this.unmaximize();}
  minimize(){return this.setWindowState('minimized');}
  destroy(){this.destroyed=true;windows.delete(this);for(const child of this.references)child.destroy();void this.page?.close().catch(()=>{});}
  close(){this.destroy();}
  setPageVisibility(visible) {
    if (this.desktop || !this.page || this.page.isClosed()) return;
    // Headless browser windows stay visible to Chromium even when minimized.
    return this.page.evaluate(shown => {
      Object.defineProperty(document,'visibilityState',{value:shown?'visible':'hidden',configurable:true});
      Object.defineProperty(document,'hidden',{value:!shown,configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));
    },visible);
  }
  showInactive(){this.visible=true;this.emit('show');return this.setPageVisibility(true);}
  show(){this.showInactive();return this.focus();}
  focus(){for(const win of windows){if(win!==this && win.focused){win.focused=false;win.emit('blur');}}this.focused=true;this.emit('focus');return this.page?.bringToFront();}
  isFocused(){return !!this.focused;}
  hide(){this.visible=false;this.focused=false;this.emit('hide');return this.setPageVisibility(false);}
  isVisible(){return this.visible&&!this.isDestroyed();}
}
