import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
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
  style = {}; children = []; textContent = ''; className = ''; classList = { add() {} };
  set innerHTML(value) { this.html = value; this.children = []; this.parts = new Map(); }
  get innerHTML() { return this.html; }
  appendChild(child) { this.children.push(child); }
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
