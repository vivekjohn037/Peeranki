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

// Match chat rejects malformed payloads, stale duplicates and rapid spam.
const { ChatInbox, normalizeChatMessage } = await import('../src/game/chat.ts');
test('chat validates text, length and sender without interpreting HTML', () => {
  assert.equal(normalizeChatMessage({id:'1',sender:'p',text:'  hi\nthere  '}).text, 'hi there');
  assert.equal(normalizeChatMessage({id:'1',sender:'p',text:'<img onerror=alert(1)>'}).text, '<img onerror=alert(1)>');
  for (const text of ['', ' ', 'a'.repeat(161), 42]) assert.equal(normalizeChatMessage({id:'1',sender:'p',text}), null);
  assert.equal(normalizeChatMessage({id:'1',text:'hello'}), null);
});
test('chat deduplicates broadcasts and limits each sender independently', () => {
  const inbox = new ChatInbox(); const m = {id:'a',sender:'p',text:'hello'};
  assert.ok(inbox.accept(m, 0)); assert.equal(inbox.accept(m, 2000), null);
  assert.equal(inbox.accept({...m,id:'b'}, 999), null);
  assert.ok(inbox.accept({...m,id:'c',sender:'q'}, 999));
  assert.ok(inbox.accept({...m,id:'b'}, 1000));
});

const { VoiceChat, parseVoiceSignal } = await import('../src/game/VoiceChat.ts');
test('voice signalling rejects malformed and oversized payloads', () => {
  const hello={voice:true,from:'a',call:'call-a',type:'hello'};
  assert.ok(parseVoiceSignal(hello));
  for(const value of [null,{}, {...hello,from:''}, {...hello,type:'unknown'}, {...hello,type:'signal',to:'b',targetCall:'call-b',description:{type:'offer',sdp:'x'.repeat(20001)}}]) assert.equal(parseVoiceSignal(value),null);
});
function voiceFixture(t, media) {
  const originals=Object.fromEntries(['document','window','navigator','RTCPeerConnection'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const tracks=[]; const pcs=[];
  const makeStream=()=>{const track={enabled:true,stopped:false,onended:null,stop(){this.stopped=true;}};tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};};
  class PC {
    connectionState='new'; remoteDescription=null; localDescription=null; candidates=[]; closed=false; offers=0; answers=0;
    constructor(){pcs.push(this);}
    addTrack(){}
    async createOffer(){this.offers++;return {type:'offer',sdp:'test-offer'};}
    async createAnswer(){this.answers++;return {type:'answer',sdp:'test-answer'};}
    async setLocalDescription(d){this.localDescription=d;}
    async setRemoteDescription(d){this.remoteDescription=d;}
    async addIceCandidate(c){assert.ok(this.remoteDescription);this.candidates.push(c);}
    close(){this.closed=true;}
  }
  const doc=new EventTarget();doc.createElement=()=>({setAttribute(){},play:()=>Promise.resolve(),pause(){},remove(){},srcObject:null});doc.hidden=false;
  for(const [k,value] of Object.entries({document:doc,window:new EventTarget(),navigator:{mediaDevices:{getUserMedia:media ?? (async()=>makeStream())}},RTCPeerConnection:PC}))Object.defineProperty(globalThis,k,{value,configurable:true,writable:true});
  const restore=()=>{for(const [k,d] of Object.entries(originals))if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];};
  return {tracks,pcs,makeStream,doc,restore};
}
test('voice negotiates once, isolates targets, mutes tracks and releases resources', async t => {
  const f=voiceFixture(t),messages=[],states={};let a,b;
  const drain=async()=>{for(let i=0;i<8;i++){while(messages.length){const [target,m]=messages.shift();await target().receive(m);}await new Promise(r=>setImmediate(r));}};
  a=new VoiceChat('a',async m=>{messages.push([()=>b,m]);},()=>['a','b'],s=>states.a=s,[]);
  b=new VoiceChat('b',async m=>{messages.push([()=>a,m]);},()=>['a','b'],s=>states.b=s,[]);
  t.after(()=>{try{a.destroy();b.destroy();}finally{f.restore();}});a.setReady(true);b.setReady(true);
  assert.equal(f.tracks.length,0); // microphone is never requested before Join
  await Promise.all([a.join(),b.join()]);await drain();
  assert.equal(f.pcs.length,2);assert.equal(f.pcs.reduce((n,p)=>n+p.offers,0),1);assert.equal(f.pcs.reduce((n,p)=>n+p.answers,0),1);
  assert.ok(f.pcs.every(p=>p.remoteDescription));
  await a.receive({voice:true,from:'stranger',call:'bad',type:'hello'});assert.equal(f.pcs.length,2);
  a.toggleMic();assert.equal(f.tracks[0].enabled,false);assert.equal(states.a.muted,true);a.toggleMic();assert.equal(f.tracks[0].enabled,true);
  a.toggleSpeakers();assert.equal(states.a.deafened,true);
  a.leave();await drain();assert.ok(f.pcs.every(p=>p.closed));assert.equal(f.tracks[0].stopped,true);assert.equal(states.a.joined,false);
});
test('leaving during microphone permission stops a late stream', async t=>{
  let resolve;const pending=new Promise(r=>resolve=r);const f=voiceFixture(t,()=>pending);let state;
  const voice=new VoiceChat('a',async()=>{},()=>['a'],s=>state=s,[]);t.after(()=>{try{voice.destroy();}finally{f.restore();}});voice.setReady(true);
  const join=voice.join();assert.equal(state.busy,true);voice.leave();const stream=f.makeStream();resolve(stream);await join;
  assert.equal(f.tracks[0].stopped,true);assert.equal(state.joined,false);assert.equal(f.pcs.length,0);
});
test('voice disconnect and backgrounding immediately release the microphone', async t=>{
  const f=voiceFixture(t);let state;const voice=new VoiceChat('a',async()=>{},()=>['a'],s=>state=s,[]);t.after(()=>{try{voice.destroy();}finally{f.restore();}});
  voice.setReady(true);await voice.join();voice.setReady(false);assert.equal(f.tracks[0].stopped,true);assert.equal(state.joined,false);
  voice.setReady(true);await voice.join();f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.tracks[1].stopped,true);assert.equal(state.joined,false);
});

const relayWorker = (await import('../src/voice-worker.ts')).default;
const relayEnv = () => ({TURN_ENABLED:'1',TURN_KEY_ID:'test-key-id',TURN_KEY_API_TOKEN:'server-only-secret',SUPABASE_URL:'https://backend.example',SUPABASE_PUBLISHABLE_KEY:'public-test-key',TURN_RATE_LIMITER:{limit:async()=>({success:true})},ASSETS:{fetch:async()=>new Response('asset')}});
const relayRequest = (body={roomCode:'ABC123',sessionId:'session-a'},origin='https://game.example')=>new Request('https://game.example/api/voice/ice',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test.jwt.token','Content-Type':'application/json'},body:JSON.stringify(body)});
test('TURN remains disabled by default and rejects unapproved origins',async()=>{
  const env=relayEnv();delete env.TURN_ENABLED;
  assert.equal((await relayWorker.fetch(relayRequest(),env)).status,503);
  assert.equal((await relayWorker.fetch(relayRequest(undefined,'https://other.example'),relayEnv())).status,403);
  const preflight=await relayWorker.fetch(new Request('https://game.example/api/voice/ice',{method:'OPTIONS',headers:{Origin:'https://localhost'}}),relayEnv());
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://localhost');
  assert.equal(await(await relayWorker.fetch(new Request('https://game.example/'),relayEnv())).text(),'asset');
});
test('TURN issues short-lived credentials only to authenticated active room members',async t=>{
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/auth/v1/user'))return Response.json({id:'user-a'});
    if(url.includes('/rest/v1/'))return Response.json([{game_status:'playing',players:[{auth_uid:'user-a',session_id:'session-a',connected:true}]}]);
    return Response.json({iceServers:[{urls:['turns:turn.example:443'],username:'temporary',credential:'temporary-password'}]});
  });
  const response=await relayWorker.fetch(relayRequest(),relayEnv());
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  const text=await response.text();assert.equal(text.includes('server-only-secret'),false);assert.ok(text.includes('temporary-password'));
  assert.equal(JSON.parse(calls[2].options.body).ttl,3600);
  assert.equal(calls[2].options.headers.Authorization,'Bearer server-only-secret');
});
test('TURN denies expired auth, nonmembers and rate-limited callers before issuing credentials',async t=>{
  const calls=[];let validAuth=true;t.mock.method(globalThis,'fetch',async url=>{calls.push(url);return url.endsWith('/auth/v1/user')?(validAuth?Response.json({id:'user-a'}):new Response('',{status:401})):Response.json([{game_status:'playing',players:[{auth_uid:'another-user',session_id:'session-a'}]}]);});
  assert.equal((await relayWorker.fetch(relayRequest(),relayEnv())).status,403);assert.equal(calls.length,2);
  validAuth=false;assert.equal((await relayWorker.fetch(relayRequest(),relayEnv())).status,401);assert.equal(calls.length,3);
  validAuth=true;const env=relayEnv();env.TURN_RATE_LIMITER.limit=async()=>({success:false});assert.equal((await relayWorker.fetch(relayRequest(),env)).status,429);assert.equal(calls.length,4);
});
test('cancelling voice while TURN credentials load releases the microphone',async t=>{
  const f=voiceFixture(t);let finish;const wait=new Promise(r=>finish=r);let state;
  const voice=new VoiceChat('a',async()=>{},()=>['a'],s=>state=s,[],()=>wait);t.after(()=>{try{voice.destroy();}finally{f.restore();}});
  voice.setReady(true);const joining=voice.join();await new Promise(r=>setImmediate(r));voice.leave();finish([{urls:'turn:example.test'}]);await joining;
  assert.equal(f.tracks[0].stopped,true);assert.equal(state.joined,false);assert.equal(f.pcs.length,0);
});
