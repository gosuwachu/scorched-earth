import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { settledDialogs, checkDialogLayout } from "./dialogs.mjs";
const base = process.argv[2] || "http://127.0.0.1:4317";
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || ["/usr/bin/chromium","/usr/bin/google-chrome"].find(existsSync),args:["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"]});
const errors=[]; mkdirSync("test-browser/out/modern",{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  page.on("pageerror",e=>errors.push(String(e)));
  await page.goto(`${base}/test-browser/online_host.html`); await page.waitForFunction(()=>!!window.onlineApp);
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.evaluate(()=>Object.assign(window.onlineApp.cfg,{SOUND:"OFF",INITIAL_CASH:0,MAX_WIND:0,MAXPLAYERS:2}));
  const click=async name=>{await settledDialogs(page);await page.getByRole("button",{name,exact:true}).click();await settledDialogs(page);};
  await click("Start");
  const style=page.getByRole("combobox",{name:"Terrain style",exact:true});
  const biome=page.getByRole("combobox",{name:"Biome",exact:true});
  const layout=page.getByRole("combobox",{name:"Map layout",exact:true});
  assert.ok(await biome.isDisabled());
  await style.selectOption("MODERN"); await biome.selectOption("SNOW"); await layout.selectOption("CAVE");
  await page.setViewportSize({width:390,height:844}); await checkDialogLayout(page,"New game");
  await page.screenshot({path:"test-browser/out/modern/setup-mobile.png"});
  await page.setViewportSize({width:1200,height:900});
  await click("Local");await click("Continue");
  await page.getByRole("textbox",{name:"Name:"}).fill("Alice");await click("Done");
  await page.getByRole("textbox",{name:"Name:"}).fill("Bob");await click("Done");
  await page.waitForFunction(()=>window.onlineApp.gs?.phase==="aim");
  assert.deepEqual(await page.evaluate(()=>[window.onlineApp.gs.terrain.modern.biome,window.onlineApp.gs.terrain.modern.layout,document.getElementById("game").width]),["SNOW","CAVE",2048]);
  await page.screenshot({path:"test-browser/out/modern/local-play.png"});
  // Save/restore through the actual application bridge and IndexedDB UI.
  await page.keyboard.press("F1");await settledDialogs(page);await click("Save Game");
  await page.getByRole("textbox",{name:"File:"}).fill("modern-ui");await click("Save");
  const original=await page.evaluate(()=>window.onlineApp.gs.terrain.modern.cells.reduce((n,c)=>n+(c>0?1:0),0));
  await page.evaluate(()=>window.onlineApp.gs.terrain.carve_circle(512,600,70));
  await page.keyboard.press("F1");await settledDialogs(page);await click("Restore Game");
  await page.getByRole("textbox",{name:"File:"}).fill("modern-ui");await click("Restore");
  await page.waitForFunction(()=>window.onlineApp.onlineScreen==="battle");
  assert.equal(await page.evaluate(()=>window.onlineApp.gs.terrain.modern.cells.reduce((n,c)=>n+(c>0?1:0),0)),original);
  assert.ok(await page.evaluate(()=>window.onlineApp.gs.terrain.grid===window.onlineApp.gs.terrain.modern.grid));
  // The high-resolution presentation must not change mouse-to-world mapping.
  const point={x:421,y:321};
  const bounds=await page.locator("#game").boundingBox();
  await page.mouse.move(bounds.x+(point.x+0.5)/1024*bounds.width,bounds.y+(point.y+0.5)/768*bounds.height);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const pointer = await page.evaluate(async()=>{const joystick=await import("/src/joystick.ts");return joystick.peek_pointer_pos();});
  // Browser mouse events quantize CSS coordinates; allow one logical pixel,
  // while rejecting the doubled coordinates a backing-store mapping would give.
  assert.ok(Math.abs(pointer[0]-point.x)<=1 && Math.abs(pointer[1]-point.y)<=1);
  // Host starts from a cloned config; Modern metadata must survive the handoff.
  await page.evaluate(()=>{
    const app=window.onlineApp; app._act("to_menu");
    Object.assign(app.cfg,{TERRAIN_STYLE:"MODERN",TERRAIN_BIOME:"DESERT",TERRAIN_LAYOUT:"CITY",INITIAL_CASH:0});
    app.startOnline([{id:"p1",name:"Alice",ai:0,icon:0,colorIndex:0},{id:"p2",name:"Bob",ai:0,icon:1,colorIndex:1}]);
  });
  await page.waitForFunction(()=>window.onlineApp.gs?.terrain.modern?.layout==="CITY");
  assert.equal(await page.evaluate(()=>window.onlineApp.gs.terrain.modern.biome),"DESERT");
  assert.deepEqual(errors,[]);
  console.log("PASS Modern setup, responsive layout, application save/restore, input mapping and host config handoff");
}finally{await browser.close();}
