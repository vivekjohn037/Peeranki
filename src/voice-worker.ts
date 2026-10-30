interface RelayEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TURN_ENABLED?: string;
  TURN_PROVIDER?: string;
  METERED_APP_DOMAIN?: string;
  METERED_TURN_API_KEY?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  VOICE_ALLOWED_ORIGINS?: string;
  TURN_RATE_LIMITER?: { limit(options: {key:string}): Promise<{success:boolean}> };
}
export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname!=='/api/voice/ice')return env.ASSETS.fetch(request);
    const origin=request.headers.get('Origin');
    const allowed=new Set([url.origin,'https://localhost','http://localhost','capacitor://localhost',...(env.VOICE_ALLOWED_ORIGINS || '').split(',').map(v=>v.trim()).filter(Boolean)]);
    const headers: Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
    if(origin && allowed.has(origin))headers['Access-Control-Allow-Origin']=origin;
    const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
    if(origin && !allowed.has(origin))return reply(403,{error:'Origin not allowed'});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
    if(request.method!=='POST')return reply(405,{error:'POST required'});
    const provider=env.TURN_PROVIDER || 'cloudflare';
    const metered=provider==='metered';
    const providerReady=metered ? Boolean(env.METERED_TURN_API_KEY && /^[a-z0-9-]+\.metered\.live$/.test(env.METERED_APP_DOMAIN || '')) : provider==='cloudflare' && Boolean(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN);
    if(env.TURN_ENABLED!=='1' || !providerReady || !env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.TURN_RATE_LIMITER)return reply(503,{error:'Relay not configured'});
    const authorization=request.headers.get('Authorization') || '';
    if(!/^Bearer [\w.-]+$/.test(authorization))return reply(401,{error:'Sign in required'});
    if(Number(request.headers.get('Content-Length') || 0)>1024)return reply(413,{error:'Request too large'});
    try {
      const raw=await request.text();if(raw.length>1024)return reply(413,{error:'Request too large'});
      let body: {roomCode?:string;sessionId?:string};try{body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid request'});}
      if(!body || typeof body!=='object')return reply(400,{error:'Invalid request'});
      const {roomCode,sessionId}=body;
      if(typeof roomCode!=='string' || !/^[A-Z0-9]{6}$/.test(roomCode) || typeof sessionId!=='string' || !sessionId || sessionId.length>100)return reply(400,{error:'Invalid room or player'});
      const authHeaders={Authorization:authorization,apikey:env.SUPABASE_PUBLISHABLE_KEY};
      const backend=env.SUPABASE_URL.replace(/\/$/,'');
      const userResponse=await fetch(backend+'/auth/v1/user',{headers:authHeaders,signal:AbortSignal.timeout(8000)});
      if(!userResponse.ok)return reply(401,{error:'Sign in required'});
      const user=await userResponse.json() as {id?:string};if(!user.id)return reply(401,{error:'Sign in required'});
      const rate=await env.TURN_RATE_LIMITER.limit({key:'voice:'+user.id});if(!rate.success)return reply(429,{error:'Wait before requesting voice again'});
      const roomResponse=await fetch(backend+'/rest/v1/game_states?room_code=eq.'+roomCode+'&select=players,game_status',{headers:authHeaders,signal:AbortSignal.timeout(8000)});
      if(!roomResponse.ok)return reply(403,{error:'Room membership required'});
      const rooms=await roomResponse.json() as {players?:{auth_uid?:string;session_id?:string;connected?:boolean}[];game_status?:string}[];
      const room=rooms[0];
      if(!room || room.game_status!=='playing' || !room.players?.some(p=>p.auth_uid===user.id && p.session_id===sessionId && p.connected!==false))return reply(403,{error:'Active room membership required'});
      // Metered's credential API key stays server-side. Clients receive only the ICE array.
      const response=metered
        ? await fetch('https://'+env.METERED_APP_DOMAIN+'/api/v1/turn/credentials?apiKey='+encodeURIComponent(env.METERED_TURN_API_KEY!),{signal:AbortSignal.timeout(8000)})
        : await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/'+encodeURIComponent(env.TURN_KEY_ID!)+'/credentials/generate-ice-servers',{method:'POST',headers:{Authorization:'Bearer '+env.TURN_KEY_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({ttl:3600}),signal:AbortSignal.timeout(8000)});
      if(!response.ok)return reply(502,{error:'Relay temporarily unavailable'});
      const data=await response.json();
      const iceServers=metered ? data as RTCIceServer[] : (data as {iceServers?:RTCIceServer[]}).iceServers;
      if(!Array.isArray(iceServers) || !iceServers.some(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>typeof u==='string' && /^turns?:/.test(u))))return reply(502,{error:'Relay credentials unavailable'});
      return reply(200,metered ? {iceServers} : {iceServers,expiresAt:Date.now()+3600_000});
    } catch {return reply(502,{error:'Relay temporarily unavailable'});}
  },
};
