export interface VoiceState { joined: boolean; busy: boolean; muted: boolean; deafened: boolean; connected: number; message: string; }
type Signal = { voice: true; from: string; call: string; type: 'hello' | 'leave' | 'signal'; to?: string; targetCall?: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
type Peer = { call: string; pc: RTCPeerConnection; audio: HTMLAudioElement; lastSeen: number; candidates: RTCIceCandidateInit[]; chain: Promise<void> };
export function parseVoiceSignal(value: unknown): Signal | null {
  const v = value as Signal;
  if (!v || v.voice !== true || !['hello','leave','signal'].includes(v.type) || typeof v.from !== 'string' || !v.from || v.from.length > 100 || typeof v.call !== 'string' || !v.call || v.call.length > 100) return null;
  if (v.type === 'signal') {
    if (typeof v.to !== 'string' || typeof v.targetCall !== 'string' || v.to.length > 100 || v.targetCall.length > 100) return null;
    if (v.description && (!['offer','answer'].includes(v.description.type) || typeof v.description.sdp !== 'string' || v.description.sdp.length > 20000)) return null;
    if (v.candidate && (typeof v.candidate.candidate !== 'string' || v.candidate.candidate.length > 2048)) return null;
    if (!v.description && !v.candidate) return null;
  }
  return v;
}
export class VoiceChat {
  private stream?: MediaStream;
  private peers = new Map<string, Peer>();
  private call = '';
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private ready = false;
  private destroyed = false;
  private state: VoiceState = { joined:false, busy:false, muted:false, deafened:false, connected:0, message:'Voice is off · join to talk' };
  private id: string;
  private send: (value: unknown) => Promise<void>;
  private members: () => string[];
  private update: (state: VoiceState) => void;
  private iceServers: RTCIceServer[];
  private loadIceServers?: () => Promise<RTCIceServer[]>;
  private onHidden = () => { if(document.hidden && (this.state.joined || this.state.busy))this.leave('Voice paused while the game is in the background · join again'); };
  private onPageHide = () => this.leave();
  constructor(id: string, send: (value: unknown) => Promise<void>, members: () => string[], update: (state: VoiceState) => void, iceServers: RTCIceServer[] = [{ urls:'stun:stun.l.google.com:19302' }], loadIceServers?: () => Promise<RTCIceServer[]>) {
    this.id=id; this.send=send; this.members=members; this.update=update; this.iceServers=iceServers; this.loadIceServers=loadIceServers; document.addEventListener('visibilitychange',this.onHidden); window.addEventListener('pagehide',this.onPageHide); this.emit();
  }
  private emit(message?: string) {
    if (message) this.state.message=message;
    this.state.connected=[...this.peers.values()].filter(p=>p.pc.connectionState==='connected').length;
    if (!this.destroyed) this.update({...this.state});
  }
  setReady(ready: boolean) { this.ready=ready; if (!ready && (this.state.joined || this.state.busy)) this.leave('Voice disconnected · join again when chat reconnects'); }
  async join() {
    if (this.destroyed || this.state.joined || this.state.busy) return;
    if (!this.ready) { this.emit('Chat is reconnecting. Try voice again shortly.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection==='undefined') { this.emit('Voice needs a supported browser and HTTPS.'); return; }
    const generation=++this.generation; this.state.busy=true; this.emit('Allow microphone access to join voice…');
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if (generation!==this.generation || this.destroyed) { stream.getTracks().forEach(t=>t.stop()); return; }
      this.stream=stream;
      let relayUnavailable=false;
      if(this.loadIceServers) { this.emit('Preparing voice connection…'); try { this.iceServers=await this.loadIceServers(); } catch { relayUnavailable=true; } }
      if(generation!==this.generation || this.destroyed) { stream.getTracks().forEach(t=>t.stop()); return; }
      this.call=crypto.randomUUID(); this.state.joined=true; this.state.busy=false; this.state.muted=false; this.state.deafened=false;
      stream.getAudioTracks().forEach(t=>t.onended=()=>this.leave('Microphone stopped · join voice again'));
      this.timer=setInterval(()=>this.heartbeat(),3000); this.emit(relayUnavailable?'Voice joined · relay unavailable, direct connections only':'Voice joined · waiting for other players');
      await this.publish({type:'hello'});
    } catch (error) {
      if (generation!==this.generation) return;
      this.leave(error instanceof Error && error.name==='NotAllowedError' ? 'Microphone blocked. Allow access in app/browser settings, then retry.' : 'Could not start voice. Check your microphone and connection.');
    }
  }
  toggleMic() { if (!this.stream) return; this.state.muted=!this.state.muted; this.stream.getAudioTracks().forEach(t=>t.enabled=!this.state.muted); this.emit(this.state.muted?'Microphone muted':'Microphone on'); }
  toggleSpeakers() { this.state.deafened=!this.state.deafened; this.peers.forEach(p=>{p.audio.muted=this.state.deafened; if(!this.state.deafened) void p.audio.play().catch(()=>this.emit('Tap Mute speakers, then Unmute to enable audio.'));}); this.emit(this.state.deafened?'Speakers muted':'Speakers on'); }
  private publish(data: Partial<Signal>) { if(!this.state.joined)return Promise.reject(new Error('Voice is off')); return this.send({...data,voice:true,from:this.id,call:this.call}); }
  private heartbeat() {
    if (!this.members().includes(this.id)) { this.leave('You left the room'); return; }
    this.peers.forEach((peer,id)=>{if(!this.members().includes(id) || Date.now()-peer.lastSeen>12000) this.remove(id);});
    void this.publish({type:'hello'}).catch(()=>this.leave('Voice connection lost · join again')); this.emit();
  }
  async receive(value: unknown) {
    const m=parseVoiceSignal(value);
    if (!m || !this.state.joined || m.from===this.id || !this.members().includes(m.from)) return;
    if (m.type==='leave') { if(this.peers.get(m.from)?.call===m.call) this.remove(m.from); return; }
    if (m.type==='signal' && (m.to!==this.id || m.targetCall!==this.call)) return;
    let peer=this.peers.get(m.from);
    if (peer && peer.call!==m.call) { if(m.type!=='hello')return; this.remove(m.from); peer=undefined; }
    if (!peer) {
      // A directed offer can arrive before the reciprocal presence announcement.
      if (m.type==='signal' && m.description?.type==='answer') return;
      peer=this.createPeer(m.from,m.call);
      void this.publish({type:'hello'}).catch(()=>{});
      if (this.id < m.from) {
        const current=peer;
        current.chain=current.chain.then(async()=>{await current.pc.setLocalDescription(await current.pc.createOffer()); await this.publish({type:'signal',to:m.from,targetCall:m.call,description:current.pc.localDescription!});}).catch(()=>this.fail(m.from,current));
      }
    }
    peer.lastSeen=Date.now();
    if (m.type!=='signal') return;
    const current=peer;
    current.chain=current.chain.then(async()=>{
      if (this.peers.get(m.from)!==current) return;
      if (m.description) {
        // The lexically smaller session alone offers, avoiding simultaneous offers.
        if (m.description.type==='offer' && this.id < m.from) return;
        await current.pc.setRemoteDescription(m.description);
        for(const candidate of current.candidates.splice(0)) await current.pc.addIceCandidate(candidate);
        if(m.description.type==='offer') { await current.pc.setLocalDescription(await current.pc.createAnswer()); await this.publish({type:'signal',to:m.from,targetCall:m.call,description:current.pc.localDescription!}); }
      } else if(m.candidate) {
        if(current.pc.remoteDescription) await current.pc.addIceCandidate(m.candidate);
        else if(current.candidates.length<100)current.candidates.push(m.candidate);
      }
    }).catch(()=>this.fail(m.from,current));
  }
  private createPeer(id: string, call: string): Peer {
    const pc=new RTCPeerConnection({iceServers:this.iceServers});
    const audio=document.createElement('audio'); audio.autoplay=true; audio.muted=this.state.deafened; audio.setAttribute('playsinline','');
    const peer: Peer={call,pc,audio,lastSeen:Date.now(),candidates:[],chain:Promise.resolve()}; this.peers.set(id,peer);
    this.stream!.getTracks().forEach(t=>pc.addTrack(t,this.stream!));
    pc.onicecandidate=event=>{if(event.candidate && this.peers.get(id)===peer)void this.publish({type:'signal',to:id,targetCall:call,candidate:event.candidate.toJSON()}).catch(()=>this.fail(id,peer));};
    pc.ontrack=event=>{audio.srcObject=event.streams[0] ?? new MediaStream([event.track]); void audio.play().catch(()=>this.emit('Audio paused · toggle speakers to enable playback.'));};
    pc.onconnectionstatechange=()=>{if(this.peers.get(id)!==peer)return; if(pc.connectionState==='failed')this.fail(id,peer);else this.emit(pc.connectionState==='connected'?'Voice connected':undefined);};
    return peer;
  }
  private fail(id: string, peer: Peer) { if(this.peers.get(id)!==peer)return; this.remove(id); this.emit('Voice could not connect. This network may need a TURN relay.'); }
  private remove(id: string) { const p=this.peers.get(id);if(!p)return;this.peers.delete(id);p.pc.ontrack=null;p.pc.onicecandidate=null;p.pc.onconnectionstatechange=null;p.pc.close();p.audio.pause();p.audio.srcObject=null;p.audio.remove();this.emit(); }
  leave(message='Voice is off · join to talk') {
    ++this.generation;
    if(this.state.joined)void this.publish({type:'leave'}).catch(()=>{});
    if(this.timer)clearInterval(this.timer);this.timer=undefined;
    this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=undefined;
    this.peers.forEach((_,id)=>this.remove(id));this.state={joined:false,busy:false,muted:false,deafened:false,connected:0,message};this.call='';this.emit();
  }
  destroy() { this.leave();this.destroyed=true; document.removeEventListener('visibilitychange',this.onHidden); window.removeEventListener('pagehide',this.onPageHide); }
}
