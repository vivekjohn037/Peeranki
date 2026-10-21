import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { hasReadyQuorum } from '../src/game/lobby.ts';
import { CountSequence } from '../src/ui/CountSequence.ts';
import { addFreshTapListener } from '../src/ui/touchUtils.ts';

function event(type, props = {}) { return Object.assign(new Event(type, { cancelable: true }), props); }
class Button extends EventTarget { disabled = false; }

test('countdown paints every number when network counts arrive in batches', () => {
  const count = new CountSequence(); const shown = [];
  count.receive(4);
  for (let now = 0; now < 400; now += 20) if (count.advance(now)) shown.push(count.value);
  count.receive(10);
  for (let now = 400; now < 1800; now += 20) if (count.advance(now)) shown.push(count.value);
  assert.deepEqual(shown, [1,2,3,4,5,6,7,8,9,10]);
  count.receive(3); assert.equal(count.value, 10); assert.equal(count.caughtUp, true);
  count.reset(); count.receive(1); assert.equal(count.advance(2000), true); assert.equal(count.value, 1);
});

test('countdown does not skip ahead after a stalled animation frame', () => {
  const count = new CountSequence(); count.receive(10); count.advance(0);
  count.advance(10000); assert.equal(count.value, 2);
  assert.equal(count.advance(10001), false);
});

test('duel choices reject an inherited click and accept a new press or keyboard action', () => {
  const button = new Button(); let choices = 0; addFreshTapListener(button, () => choices++);
  button.dispatchEvent(event('click', { detail: 1 })); assert.equal(choices, 0);
  button.dispatchEvent(event('pointerdown', { button: 0, isPrimary: true }));
  button.dispatchEvent(event('click', { detail: 1 })); assert.equal(choices, 1);
  button.dispatchEvent(event('click', { detail: 1 })); assert.equal(choices, 1);
  button.dispatchEvent(event('click', { detail: 0 })); assert.equal(choices, 2);
  button.disabled = true;
  button.dispatchEvent(event('pointerdown', { button: 0 })); button.dispatchEvent(event('click', { detail: 0 }));
  assert.equal(choices, 2);
});

// Exercise the actual modal with a small DOM fixture; no browser globals are needed.
let source = fs.readFileSync(new URL('../src/ui/DuelModalComponent.ts', import.meta.url), 'utf8');
source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
for (const name of ['touchUtils', 'html']) source = source.replace(`'./${name}'`, JSON.stringify(new URL(`../src/ui/${name}.ts`, import.meta.url).href));
const { DuelModalComponent } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
class Element extends Button {
  style = { setProperty() {} }; dataset = {}; children = []; textContent = ''; className = ''; classList = { add() {}, toggle() {} };
  set innerHTML(value) { this.html = value; this.children = []; this.parts = new Map(); }
  get innerHTML() { return this.html; }
  appendChild(child) { this.children.push(child); }
  append(child) { this.children.push(child); }
  remove() { this.removed = true; }
  setAttribute(key, value) { (this.attributes ??= {})[key] = value; }
  querySelector(selector) { if (!this.parts.has(selector)) this.parts.set(selector, new Element()); return this.parts.get(selector); }
  querySelectorAll() { return this.children; }
}
const state = { active: true, round: 1, contestantIds: [1,2], canChoose: true, hasSubmitted: false, myChoice: null, opponentName: 'Other', opponentSubmitted: false };

test('duel delays reveal, arms later, keeps stable buttons and cancels on exit', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.document = { createElement: () => new Element() };
  let submitted = 0;
  const duel = new DuelModalComponent({ onSubmitDuelChoice() { submitted++; } });
  duel.update(state);
  const backdrop = duel.getElement(), dialog = backdrop.children[0];
  assert.equal(backdrop.style.display, 'none');
  t.mock.timers.tick(749); assert.equal(backdrop.style.display, 'none');
  t.mock.timers.tick(1); assert.equal(backdrop.style.display, 'flex');
  let grid = dialog.querySelector('.pk-rps-buttons-grid'); assert.ok(grid.children.every(button => button.disabled));
  t.mock.timers.tick(250);
  grid = dialog.querySelector('.pk-rps-buttons-grid'); const rock = grid.children[0];
  duel.update({...state}); assert.equal(dialog.querySelector('.pk-rps-buttons-grid').children[0], rock);
  rock.dispatchEvent(event('click', { detail: 1 })); assert.equal(submitted, 0);
  rock.dispatchEvent(event('pointerdown', { button: 0 })); rock.dispatchEvent(event('click', { detail: 1 }));
  assert.equal(submitted, 1); assert.ok(grid.children.every(button => button.disabled));
  duel.update({...state, round: 2}); duel.update({...state, active: false});
  t.mock.timers.tick(2000); assert.equal(backdrop.style.display, 'none');
  duel.destroy(); delete globalThis.document;
});

let lobbySource = fs.readFileSync(new URL('../src/ui/LobbyComponent.ts', import.meta.url), 'utf8');
lobbySource = ts.transpileModule(lobbySource, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText.replace("'./html'", JSON.stringify(new URL('../src/ui/html.ts', import.meta.url).href));
lobbySource = lobbySource.replace("'../game/lobby'", JSON.stringify(new URL('../src/game/lobby.ts', import.meta.url).href));
const { LobbyComponent } = await import('data:text/javascript;base64,' + Buffer.from(lobbySource).toString('base64'));

test('waiting room renders safe player slots and follows room capacity and host changes', () => {
  globalThis.document = { createElement: () => new Element() };
  const parent = new Element(); let starts = 0;
  const state = {code:'ABC123',capacity:3,publicRoom:false,host:true,hostSession:'host',localSession:'host',minutes:5,players:[{name:'<img onerror=bad>',sessionId:'host'}]};
  const lobby = new LobbyComponent(parent,state,()=>starts++,async()=>{});
  const root=parent.children[0], start=root.querySelector('.pk-lobby-start');
  assert.equal(start.disabled,true); assert.equal(start.hidden,false);
  const slots=root.querySelector('.pk-lobby-slots');
  assert.ok(slots.innerHTML.includes('&lt;img onerror=bad&gt;')); assert.ok(!slots.innerHTML.includes('<img onerror=bad>'));
  assert.equal((slots.innerHTML.match(/pk-lobby-slot /g)||[]).length,3);
  const full={...state,players:[...state.players,{name:'Second',sessionId:'second'},{name:'Third',sessionId:'third'}].map(player=>({...player,ready:true}))};
  lobby.update(full); assert.equal(start.disabled,false); start.onclick(); assert.equal(starts,1);
  lobby.setStarting(true); assert.equal(start.disabled,true);
  lobby.setStarting(false); lobby.update({...full,host:false,hostSession:'second'}); assert.equal(start.hidden,true);
  lobby.update({...state,publicRoom:true}); assert.equal(start.hidden,true);
  lobby.destroy(); assert.equal(root.removed,true); delete globalThis.document;
});

test('waiting-room leave action only sends one request', async () => {
  globalThis.document = { createElement: () => new Element() };
  const parent = new Element(); let leaves = 0;
  const lobby = new LobbyComponent(parent,{code:'ABC123',capacity:3,publicRoom:true,host:true,hostSession:'host',localSession:'host',minutes:5,players:[]},()=>{},async()=>{leaves++;});
  const leave=parent.children[0].querySelector('.pk-lobby-leave');
  await leave.onclick(); await leave.onclick(); assert.equal(leaves,1); assert.equal(leave.disabled,true);
  lobby.destroy(); delete globalThis.document;
});


test('readiness requires every seat and explicit approval from every connected player', () => {
 assert.equal(hasReadyQuorum([{ready:true},{ready:true}],3),false);
 assert.equal(hasReadyQuorum([{ready:true},{ready:true},{}],3),false);
 assert.equal(hasReadyQuorum([{ready:true},{ready:true},{ready:false}],3),false);
 assert.equal(hasReadyQuorum([{ready:true},{ready:true},{ready:true}],3),true);
 assert.equal(hasReadyQuorum([{ready:true},{ready:true},{ready:true,connected:false}],3),false);
});

test('Ready toggle saves shared state and disables itself while saving', async () => {
 globalThis.document = {createElement:()=>new Element()};
 const parent=new Element(); const state={code:'ABC123',capacity:3,publicRoom:false,host:true,hostSession:'host',localSession:'host',minutes:5,players:[{name:'Host',sessionId:'host',ready:false},{name:'Second',sessionId:'second',ready:true},{name:'Third',sessionId:'third',ready:true}]};
 let finish; let requests=0;
 const lobby=new LobbyComponent(parent,state,()=>{},async()=>{},ready=>{ requests++; return new Promise(resolve=>{finish=()=>{state.players[0].ready=ready;lobby.update(state);resolve();};});});
 const root=parent.children[0],button=root.querySelector('.pk-lobby-toggle-ready'),start=root.querySelector('.pk-lobby-start');
 assert.equal(button.textContent,'Not Ready');assert.equal(start.disabled,true);
 const pending=button.onclick();assert.equal(button.disabled,true);await button.onclick();assert.equal(requests,1);
 finish();await pending;assert.equal(button.textContent,'✓ Ready');assert.equal(button.disabled,false);assert.equal(start.disabled,false);
 const unready=button.onclick();finish();await unready;assert.equal(start.disabled,true);assert.equal(button.textContent,'Not Ready');
 lobby.destroy();delete globalThis.document;
});
