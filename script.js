// 功能區段：spotify-app.js
'use strict';
const $=id=>document.getElementById(id);
const CLIENT='cb92bc22e6874cb2aaac8764f1324109',KEY='vinyl-room.spotify.collection.v1',REDIRECT=new URL('./',location.href).href;
const makeId=()=>crypto.randomUUID();
const defaultVinylDesign=()=>({pattern:'solid',color:'#151819',accent:'#151819',opacity:100,amount:0,seed:1847,translucent:false});
const emptyRecord={id:'empty',title:'尚未選擇歌曲',artist:'',demo:true};
let tracks=[],selected=emptyRecord,player=null,ready=false,demoOn=false,demoRatio=0,needleDown=false,session=0,toastTimer;
let sdk=null,device=null,current=null,auth=null,refreshing=null,startedRecord=null,startedTrack=null,playGeneration=0,failedGeneration=-1,lastPosition=0,lastTime=0,advanceTimer=0,albumEnded=false,activeIndex=0,queueEnd=0,trackStartedAt=0,awaitingFirstTrack=false,singleFallbackUsed=false;
let playCommands=Promise.resolve(),pendingPause=Promise.resolve(),pollBusy=false;
const RESUME_KEY='vinyl-room.spotify.resume.v1';
let resumePoint=null,userPaused=false,lastResumeSave=0,deviceCheckBusy=false,deviceCheckAt=0;
function readResume(){try{const r=JSON.parse(localStorage.getItem(RESUME_KEY)||'null');return r&&typeof r.recordId==='string'&&typeof r.trackId==='string'&&Number.isFinite(r.position)&&r.position>=0?r:null}catch{return null}}
function saveResume(force=false){if(selected.demo||!current||startedRecord!==selected.id)return;if(!force&&Date.now()-lastResumeSave<5000)return;lastResumeSave=Date.now();try{localStorage.setItem(RESUME_KEY,JSON.stringify({recordId:selected.id,trackId:selected.items[activeIndex]?.id,position:Math.max(0,current.position||0),duration:current.duration||0}))}catch{}}
function pauseHere(){userPaused=true;clearTimeout(advanceTimer);albumEnded=false;saveResume(true);return sdk?.pause()}
window.addEventListener('pagehide',()=>saveResume(true));
async function inspectOutput(){
 if(!auth||deviceCheckBusy||Date.now()-deviceCheckAt<10000)return;
 deviceCheckBusy=true;deviceCheckAt=Date.now();const instance=sdk;
 try{const result=await api('me/player/devices');if(instance!==sdk)return;const active=result?.devices?.find(d=>d.is_active);const label=$('outputDevice');
 if(label)label.textContent=!device?'拾音室播放器：離線':active?('播放裝置：'+(active.id===device?'此頁拾音室':active.name||'其他 Spotify 裝置')):'播放裝置：尚未啟用';
 if(active&&active.id!==device){clearTimeout(advanceTimer);albumEnded=false;current=null;motion(false)}
 }catch{if($('outputDevice'))$('outputDevice').textContent='播放裝置：暫時無法確認'}finally{deviceCheckBusy=false}
}
const playbackEvents=[];
function logPlayback(event,detail={}){playbackEvents.push({at:new Date().toISOString(),event,ready:!!device,index:activeIndex+1,...detail});if(playbackEvents.length>50)playbackEvents.shift()}
let pendingAlbum=null,editingRecord=null,coverDraft=null,coverGeneration=0,coverBusy=false;
const SPOTIFY_ID=/^[A-Za-z0-9]{22}$/;
function notify(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),5000)}
function connection(message){$('spotifyConnection').textContent=message;$('spotifyPlayerConnection').textContent=message}
function error(err){connection(err?.message||String(err));notify(err?.message||String(err))}
function readSession(key){try{return JSON.parse(sessionStorage.getItem(key)||'null')}catch{return null}}
function readStoredAuth(){try{return JSON.parse(localStorage.getItem('vinyl-room.spotify.auth.v1')||'null')}catch{return null}}
function clearAuth(){auth=null;try{localStorage.removeItem('vinyl-room.spotify.auth.v1')}catch{}sessionStorage.removeItem('spotify.auth')}
auth=readStoredAuth()||readSession('spotify.auth');
if(auth?.refresh){try{localStorage.setItem('vinyl-room.spotify.auth.v1',JSON.stringify(auth))}catch{}}else auth=null;
function validCover(c){return c==null||typeof c==='object'&&(c.data===''||c.data==null||typeof c.data==='string'&&c.data.length<650000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(c.data))&&Number.isFinite(c.zoom)&&c.zoom>=1&&c.zoom<=3&&Number.isFinite(c.x)&&c.x>=0&&c.x<=100&&Number.isFinite(c.y)&&c.y>=0&&c.y<=100}
function validTrack(t){return !!(t&&SPOTIFY_ID.test(t.spotifyId||'')&&['album','track'].includes(t.type)&&typeof t.id==='string'&&typeof t.title==='string'&&typeof t.artist==='string'&&typeof t.image==='string'&&validCover(t.cover)&&Array.isArray(t.items)&&t.items.length>0&&t.items.every(x=>x&&SPOTIFY_ID.test(x.id||'')&&typeof x.name==='string'&&typeof x.uri==='string'))}
try{const data=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(data))tracks=data.filter(validTrack).slice(0,200)}catch{notify('無法讀取本機 Spotify 收藏。')}
function persist(){try{localStorage.setItem(KEY,JSON.stringify(tracks));return true}catch{notify('儲存空間不足，請備份收藏或減少圖片。');return false}}
function all(){return tracks}
function thumbId(t){return t?.image||''}
function isAlbum(){return selected?.type==='album'}
function format(s){s=Math.max(0,Math.floor(Number(s)||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')}
function applyCoverStyle(img,crop){const c=crop||{zoom:1,x:50,y:50};img.style.objectPosition=`${c.x}% ${c.y}%`;img.style.transformOrigin=`${c.x}% ${c.y}%`;img.style.transform=`scale(${c.zoom})`}
function setNeedle(ratio,down=true){if(window.vinylArmDragging||(down&&window.vinylArmParked))return;const r=Math.max(0,Math.min(1,Number(ratio)||0));needleDown=down;$('tonearm').setAttribute('aria-valuenow',Math.round(r*100));$('tonearm').setAttribute('transform',`rotate(${(down?20+21*r:-8).toFixed(3)} 438 62)`);$('needleNote').textContent=down?'唱針位置 · 依目前曲目進度':'唱針已歸位';$('needlePercent').textContent=down?Math.round(r*100)+'%':'—'}
function motion(on){if(on)window.vinylArmParked=false;document.body.classList.toggle('music-playing',on);$('record').classList.toggle('spinning',on);$('powerLight').classList.toggle('on',on);$('play').textContent=on?'Ⅱ':'▶';$('play').setAttribute('aria-label',on?'暫停':'播放')}
function imageURL(t){return t?.cover?.data||(/^https:\/\//.test(t?.image||'')?t.image:'')}
function drawCover(container,t){const src=imageURL(t);if(!src)return;const img=document.createElement('img');img.src=src;img.alt=t.title+' 封面';img.loading='lazy';img.draggable=false;applyCoverStyle(img,t.cover);container.append(img)}
function updateDisc(){const artwork=$('nowAlbumCover');artwork.replaceChildren();drawCover(artwork,selected);artwork.hidden=selected.demo;window.VinylCustom?.selection();const label=$('recordLabel');label.querySelector('.disc-cover')?.remove();const src=imageURL(selected);label.classList.toggle('photo',!!src);label.style.backgroundColor='#52684f';if(src){const img=document.createElement('img');img.src=src;img.alt='';img.className='disc-cover';applyCoverStyle(img,selected.cover);label.append(img)}window.VinylRoomUI?.artwork(selected)}
function reorderRecords(from,to){if(from<0||to<0||from>=tracks.length||to>=tracks.length||from===to)return;const old=tracks;tracks=tracks.slice();tracks.splice(to,0,tracks.splice(from,1)[0]);if(!persist()){tracks=old;return}render();notify('收藏順序已更新')}
let drag=null,suppressUntil=0;
document.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.pointerId)return;if(!drag.active){if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<7)return;drag.active=true;drag.row.setPointerCapture(e.pointerId)}e.preventDefault();const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('#shelf .album');drag.target=target?.dataset.recordId||null;drag.after=!!target&&e.clientY>target.getBoundingClientRect().top+target.offsetHeight/2;document.querySelectorAll('#shelf .album').forEach(el=>el.classList.toggle('dragging',el===drag.row));if(target&&drag.target!==drag.id)target.classList.add(drag.after?'drop-after':'drop-before')},{passive:false});
function endDrag(commit){const d=drag;drag=null;if(!d)return;document.querySelectorAll('#shelf .album').forEach(el=>el.classList.remove('dragging','drop-before','drop-after'));if(!d.active)return;suppressUntil=Date.now()+400;if(commit&&d.target&&d.target!==d.id){const from=tracks.findIndex(t=>t.id===d.id),target=tracks.findIndex(t=>t.id===d.target);let to=target+(d.after?1:0);if(from<to)to--;reorderRecords(from,to)}}
document.addEventListener('pointerup',()=>endDrag(true));document.addEventListener('pointercancel',()=>endDrag(false));
function render(){const shelf=$('shelf');shelf.replaceChildren();$('count').textContent=String(tracks.length).padStart(2,'0');tracks.forEach((t,i)=>{const row=document.createElement('article');row.className='album';row.dataset.recordId=t.id;row.onpointerdown=e=>{if(e.button===0&&!e.target.closest('.record-menu'))drag={pointerId:e.pointerId,x:e.clientX,y:e.clientY,id:t.id,row,active:false,target:null}};const b=document.createElement('button');b.className='album-select';b.title='按住封面拖曳排序';b.setAttribute('aria-label','選擇 '+t.title);const cover=document.createElement('div');cover.className='cover';drawCover(cover,t);if(!cover.firstChild)cover.textContent='◉';const name=document.createElement('span');name.className='album-name';name.textContent=t.title;const artist=document.createElement('span');artist.className='album-artist';artist.textContent=t.artist||'Spotify 收藏';b.append(cover,name,artist);if(t.sticker){const label=document.createElement('span');label.className='vinyl-sticker';label.textContent=t.sticker;b.append(label)}b.onclick=()=>{if(Date.now()<suppressUntil)return;window.VinylRoomUI?.focus(t.id)};row.append(b);const menu=document.createElement('details');menu.className='record-menu';const summary=document.createElement('summary');summary.textContent='⋯';summary.title='編輯功能';menu.append(summary);const actions=document.createElement('div');actions.className='record-menu-actions';for(const [label,fn] of [['編輯名稱與歌手',()=>openEdit(t)],['更換封面',()=>openCover(t)],['往前移',()=>reorderRecords(i,i-1)],['往後移',()=>reorderRecords(i,i+1)],['移除收藏',()=>remove(t)]]){const a=document.createElement('button');a.textContent=label;a.onclick=()=>{menu.open=false;fn()};actions.append(a)}menu.append(actions);menu.addEventListener('toggle',()=>{if(menu.open){const r=summary.getBoundingClientRect();actions.style.left=Math.max(8,Math.min(innerWidth-198,r.right-190))+'px';actions.style.top=Math.max(8,Math.min(innerHeight-230,r.bottom+5))+'px'}});row.append(menu);shelf.append(row)});const add=document.createElement('button');add.className='add-card';add.textContent='＋ 加入 Spotify 專輯／歌曲';add.onclick=openAlbum;shelf.append(add);window.VinylRoomUI?.render()}
// 每張唱片的貼紙與收藏資料一同儲存。
function openEdit(t){let choice=$('recordSticker');if(!choice){const label=document.createElement('label');label.textContent='\u5c08\u5c6c\u8cbc\u7d19';choice=document.createElement('select');choice.id='recordSticker';for(const name of ['','\u6700\u611b','\u4e0b\u96e8\u5929','\u8b80\u66f8','\u653e\u9b06','\u901a\u52e4']){const item=document.createElement('option');item.value=name;item.textContent=name||'\u4e0d\u52a0\u8cbc\u7d19';choice.append(item)}label.append(choice);$('recordEditArtist').parentNode.after(label)}choice.value=t.sticker||'';editingRecord=t;$('recordEditTitle').value=t.title;$('recordEditArtist').value=t.artist;$('recordEditDialog').showModal()}
$('closeRecordEdit').onclick=()=>$('recordEditDialog').close();
$('recordEditForm').onsubmit=e=>{e.preventDefault();const t=editingRecord;if(!t)return;const before=[t.title,t.artist,t.sticker];t.title=$('recordEditTitle').value.trim();t.artist=$('recordEditArtist').value.trim();t.sticker=$('recordSticker').value;if(!t.title||!persist()){[t.title,t.artist,t.sticker]=before;return}render();if(selected.id===t.id){$('discTitle').textContent=t.title;renderQueue()}$('recordEditDialog').close()};
function remove(t){const old=tracks;tracks=tracks.filter(x=>x.id!==t.id);if(!persist()){tracks=old;return}if(selected.id===t.id)select(tracks[0]||emptyRecord);else render();window.VinylRoomUI?.showLibrary();notify('已移除收藏')}
function renderQueue(){const panel=$('albumPanel');panel.hidden=selected.demo;if(selected.demo)return;$('albumTitle').textContent=selected.title;$('albumNote').textContent='點曲目播放；曲目資料來自 Spotify。';$('albumCount').textContent=selected.items.length+' 首';$('titleScanStatus').textContent='';const list=$('tracklist');list.replaceChildren();selected.items.forEach((item,i)=>{const li=document.createElement('li'),b=document.createElement('button');b.className='track-button'+(startedRecord===selected.id&&startedTrack===item.id?' current':'');const n=document.createElement('small');n.textContent=String(i+1).padStart(2,'0');const title=document.createElement('span');title.textContent=item.name;b.append(n,title);b.onclick=()=>playTrack(i).catch(error);li.append(b);list.append(li)})}
function updateNowPlaying(){if(selected.demo){$('nowTitle').textContent='尚未選擇歌曲';$('nowArtist').hidden=true;return}const item=current?.track_window?.current_track;const belongs=item&&selected.items.some(x=>x.id===item.id||x.id===item.linked_from?.id);$('nowTitle').textContent=belongs?item.name:selected.type==='track'?selected.title:selected.items[activeIndex]?.name||selected.title;$('nowArtist').hidden=false;$('nowArtist').textContent=(selected.type==='album'?selected.title+' · ':'')+selected.artist}
function select(t,pause=true){saveResume(true);resumePoint=null;userPaused=false;clearTimeout(advanceTimer);session++;playGeneration++;albumEnded=false;activeIndex=0;queueEnd=0;awaitingFirstTrack=false;singleFallbackUsed=false;startedRecord=null;startedTrack=null;selected=t;logPlayback('select');window.VinylLyrics?.reset();pendingPause=pause&&sdk?playCommands.catch(()=>{}).then(()=>sdk.pause()).catch(()=>{}):Promise.resolve();current=null;motion(false);setNeedle(0,false);$('seek').disabled=true;$('seek').value=0;$('currentTime').textContent='0:00';$('duration').textContent='0:00';$('discTitle').textContent=t.demo?'等待播放':t.title;$('spotifyLink').hidden=t.demo;if($('spotifyLyricsSource'))$('spotifyLyricsSource').hidden=true;$('spotifyLink').href=t.demo?'#':'https://open.spotify.com/'+t.type+'/'+t.spotifyId;updateNowPlaying();updateDisc();render();renderQueue();$('status').textContent='尚未播放';window.VinylRoomUI?.select(t)}
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
const SPOTIFY_SCOPES='streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state user-library-read';
async function login(importAfter=false){const verifier=b64(crypto.getRandomValues(new Uint8Array(48))),state=b64(crypto.getRandomValues(new Uint8Array(24)));sessionStorage.setItem('spotify.pkce',JSON.stringify({verifier,state,scope:SPOTIFY_SCOPES,created:Date.now()}));if(importAfter)sessionStorage.setItem('spotify.pending-import','1');const challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));const u=new URL('https://accounts.spotify.com/authorize');u.search=new URLSearchParams({client_id:CLIENT,response_type:'code',redirect_uri:REDIRECT,scope:SPOTIFY_SCOPES,state,code_challenge_method:'S256',code_challenge:challenge});location.assign(u.href)}
async function tokenRequest(body){const r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});if(!r.ok){const detail=await r.json().catch(()=>({}));const err=Error(detail.error==='invalid_grant'?'Spotify 授權已失效，請重新連接。':'Spotify 授權失敗，請檢查連線並重試。');err.code=detail.error||String(r.status);throw err}return r.json()}
function storeAuth(t,requestedScope){auth={access:t.access_token,refresh:t.refresh_token||auth?.refresh,expires:Date.now()+t.expires_in*1000,scope:t.scope||requestedScope||auth?.scope||''};try{localStorage.setItem('vinyl-room.spotify.auth.v1',JSON.stringify(auth))}catch{sessionStorage.setItem('spotify.auth',JSON.stringify(auth));notify('此瀏覽器無法保存登入，關閉分頁後需重新連接。')}}
async function token(){if(!auth)throw Error('請先連接 Spotify。');if(auth.expires>Date.now()+60000)return auth.access;if(!refreshing)refreshing=tokenRequest({client_id:CLIENT,grant_type:'refresh_token',refresh_token:auth.refresh}).then(t=>storeAuth(t)).catch(err=>{if(err.code==='invalid_grant'){clearAuth();showAuthUI()}throw err}).finally(()=>refreshing=null);await refreshing;return auth.access}
function showAuthUI(){const signed=!!auth;$('spotifyLogin').hidden=signed;$('spotifyLogout').hidden=!signed;if($('spotifyReconnect'))$('spotifyReconnect').hidden=!signed||!!device}
const outputLabel=document.createElement('p');outputLabel.id='outputDevice';outputLabel.className='spotify-connection';outputLabel.setAttribute('aria-live','polite');outputLabel.textContent='播放裝置：尚未確認';$('spotifyPlayerConnection').after(outputLabel);
const playerReconnect=document.createElement('button');playerReconnect.type='button';playerReconnect.className='outline';playerReconnect.textContent='重新連接';outputLabel.after(playerReconnect);playerReconnect.onclick=()=>reconnectPlayer().catch(error);
const reconnectButton=document.createElement('button');reconnectButton.type='button';reconnectButton.id='spotifyReconnect';reconnectButton.className='outline';reconnectButton.textContent='重新連接播放器';$('spotifyLogin').after(reconnectButton);reconnectButton.onclick=()=>reconnectPlayer().catch(err=>{connection('已登入 Spotify，但播放器連線失敗：'+err.message);notify('播放器連線失敗，請再按「重新連接播放器」。')});showAuthUI();
async function api(path,method='GET',body){
  const r=await fetch('https://api.spotify.com/v1/'+path,{method,headers:{Authorization:'Bearer '+await token(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(path.startsWith('me/player/play'))logPlayback('api_play_response',{status:r.status});
  if(r.status===204)return null;
  if(!r.ok){
    let message='Spotify 回應 '+r.status+'，請稍後再試。';
    if(r.status===403)message='Spotify 拒絕操作；請檢查 Premium、開發模式允許的帳號和 App 權限。';
    if(r.status===429)message='Spotify 請求過於頻繁，請稍後再試。';
    if(r.status===401)message='登入失效，請登出後重新連接 Spotify。';
    const err=Error(message);err.code=String(r.status);throw err
  }
  return r.json()
}
let reconnecting=null;
async function reconnectPlayer(){if(reconnecting)return reconnecting;reconnecting=repairPlayer().finally(()=>{reconnecting=null});return reconnecting}
async function repairPlayer(){saveResume(true);resumePoint=readResume();clearTimeout(advanceTimer);albumEnded=false;sdk?.disconnect();sdk=null;device=null;ready=false;current=null;motion(false);deviceCheckAt=0;await connect();const instance=sdk,id=device;await instance.activateElement();const confirmed=await ensureBrowserOutput(id,()=>sdk===instance&&device===id);if(confirmed){deviceCheckAt=0;await inspectOutput();connection('拾音室播放器已重新連線 · 按播放接續音樂')}}
async function connect(){
  if(!auth)throw Error('請先連接 Spotify。');
  if(sdk&&device)return;
  sdk?.disconnect();sdk=null;device=null;showAuthUI();
  connection('正在連接 Spotify 播放器…');
  await token();
  if(!window.Spotify)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Spotify 播放器載入逾時，請重新整理。')),18000);window.onSpotifyWebPlaybackSDKReady=()=>{clearTimeout(timer);resolve()};const s=document.createElement('script');s.src='https://sdk.scdn.co/spotify-player.js';s.onerror=()=>{clearTimeout(timer);reject(Error('無法載入 Spotify 播放器。'))};document.head.append(s)});
  let markReady;
  const whenReady=new Promise(resolve=>markReady=resolve);
  const instance=new Spotify.Player({name:'拾音室 Spotify',getOAuthToken:cb=>token().then(cb).catch(error),volume:Number($('volumeLevel').value)/100});
  sdk=instance;
  instance.addListener('ready',({device_id})=>{if(sdk!==instance)return;device=device_id;ready=true;player=adapter;markReady();showAuthUI();window.VinylCustom?.applyVolume();connection('Spotify 已連線 · 可加入專輯並播放')});
  instance.addListener('not_ready',()=>{if(sdk!==instance)return;saveResume(true);resumePoint=readResume();clearTimeout(advanceTimer);albumEnded=false;current=null;motion(false);device=null;ready=false;showAuthUI();connection('Spotify 播放器暫時離線，請按「重新連接播放器」。')});
  instance.addListener('player_state_changed',state=>{if(sdk===instance)display(state)});
  for(const type of ['initialization_error','authentication_error','account_error'])instance.addListener(type,({message})=>{if(sdk===instance)error(Error('Spotify：'+message))});
  instance.addListener('playback_error',event=>{if(sdk===instance)handlePlaybackError(event)});
  instance.addListener('autoplay_failed',()=>{if(sdk===instance){logPlayback('autoplay_blocked');connection('瀏覽器阻擋自動播放，請再按播放。');notify('瀏覽器阻擋自動播放，請再按播放。')}});
  if(!await instance.connect())throw Error('Spotify 播放器無法連線，請確認瀏覽器及 Premium。');
  await Promise.race([whenReady,new Promise((_,reject)=>setTimeout(()=>reject(Error('Spotify 播放器未就緒，請按「重新連接播放器」。')),15000))]);
}
const adapter={getDuration:()=>current?.duration/1000||0,getCurrentTime:()=>current?.position/1000||0,pauseVideo:()=>pauseHere(),playVideo:()=>{userPaused=false;return current?sdk.resume():playTrack(activeIndex,singleFallbackUsed)},seekTo:seconds=>sdk?.seek(Math.round(seconds*1000)),setVolume:level=>sdk?.setVolume(level/100).catch(error)};
async function ensurePlayer(){if(!sdk||!device)throw Error('請先連接 Spotify，等待播放器就緒。');return adapter}
function mediaPolicy(){try{return (document.permissionsPolicy||document.featurePolicy)?.allowsFeature('encrypted-media')??null}catch{return null}}
async function ensureBrowserOutput(id,isCurrent){
  if(!isCurrent())return false;
  let target;
  for(let attempt=0;attempt<7;attempt++){
    if(!isCurrent())return false;
    const list=await api('me/player/devices');
    if(!isCurrent())return false;
    target=list?.devices?.find(x=>x.id===id);
    if(target)break;
    if(attempt<6){connection('正在等待 Spotify 登錄此頁的播放裝置…');await new Promise(resolve=>setTimeout(resolve,700))}
  }
  if(!target||target.is_restricted){const err=Error('Spotify 尚未登錄此頁的播放裝置。請用獨立 Chrome／Edge 分頁開啟，再按重新連接；若仍失敗，請檢查瀏覽器的受保護內容播放設定。');err.code='device_unavailable';throw err}
  if(target.is_active){logPlayback('browser_output_confirmed');return true}
  connection('正在把播放裝置切換到這個拾音室頁面…');logPlayback('browser_transfer_requested');
  await api('me/player','PUT',{device_ids:[id],play:false});
  for(let attempt=0;attempt<6;attempt++){
    await new Promise(resolve=>setTimeout(resolve,500));
    if(!isCurrent())return false;
    const result=await api('me/player/devices');
    if(!isCurrent())return false;
    if(result?.devices?.some(x=>x.id===id&&x.is_active&&!x.is_restricted)){logPlayback('browser_output_confirmed');return true}
  }
  const err=Error('Spotify 尚未將聲音切換到此頁。請在 Spotify 的裝置清單選擇「拾音室 Spotify」，再按播放。');err.code='device_transfer_timeout';throw err
}
function handlePlaybackError({message}){
  clearTimeout(advanceTimer);failedGeneration=playGeneration;albumEnded=false;
  singleFallbackUsed=singleFallbackUsed||queueEnd>activeIndex;
  current=null;motion(false);
  const policy=mediaPolicy();
  logPlayback('sdk_playback_error',{category:/autoplay/i.test(message)?'autoplay':/encrypt|eme|drm|widevine/i.test(message)?'encrypted_media':/premium|account/i.test(message)?'account':'track_load',encryptedMedia:policy,embedded:window.top!==window});
  connection(policy===false?'這個瀏覽器頁面禁止加密音訊，請把網站網址貼到 Chrome 或 Edge 開啟。':'Spotify 播放中斷（'+message+'）。請按播放重試'+(singleFallbackUsed?'；將改用單曲模式。':'。'));
  notify(policy===false?'此瀏覽器無法播放加密音訊，請改用 Chrome 或 Edge。':'播放中斷，請按播放重試。')
}
async function playTrack(i=0,single=false){
  if(window.VinylModes?.value()==='single')single=true;
  userPaused=false;
  if(selected.demo)throw Error('請先加入一張 Spotify 專輯。');
  const own=selected.id,track=selected.items[i];
  if(!track)throw Error('找不到這首曲目。');
  const d=device;if(!sdk||!d)throw Error('請先連接 Spotify，等待播放器就緒。');
  const activation=sdk.activateElement(); // Must occur directly inside the user's click handler.
  const pauseBeforePlay=pendingPause;
  const generation=++playGeneration;
  clearTimeout(advanceTimer);
  failedGeneration=-1;activeIndex=i;queueEnd=single?i:selected.items.length-1;
  singleFallbackUsed=single;awaitingFirstTrack=true;
  startedRecord=own;startedTrack=track.id;albumEnded=false;trackStartedAt=Date.now();
  current=null;motion(false);updateNowPlaying();renderQueue();
  const uris=selected.items.slice(i,queueEnd+1).map(x=>x.uri);
  const albumContext=selected.type==='album'&&!single;
  const resumeMs=resumePoint?.recordId===own&&resumePoint?.trackId===track.id?resumePoint.position:0;
  const body=albumContext?{context_uri:'spotify:album:'+selected.spotifyId,offset:{position:i},position_ms:resumeMs}:{uris,position_ms:resumeMs};
  logPlayback('play_requested',{count:uris.length,mode:single?'single':albumContext?'album_context':'track'});
  const job=playCommands.catch(()=>{}).then(async()=>{
    await pauseBeforePlay;
    await activation;
    if(generation!==playGeneration||selected.id!==own||device!==d)return;
    if(!await ensureBrowserOutput(d,()=>generation===playGeneration&&selected.id===own&&device===d))return;
    await api('me/player/play?device_id='+encodeURIComponent(d),'PUT',body);
    if(generation===playGeneration){
      logPlayback('play_accepted',{count:uris.length});
      connection(`已送出第 ${i+1} / ${selected.items.length} 首播放指令，等待 Spotify 播放器…`);
      setTimeout(async()=>{
        if(generation!==playGeneration||failedGeneration===generation||!awaitingFirstTrack||!device)return;
        const state=await sdk?.getCurrentState().catch(()=>null);
        if(generation!==playGeneration||!awaitingFirstTrack||!device)return;
        if(state?.track_window?.current_track?.id===track.id){display(state);return}
        failedGeneration=generation;singleFallbackUsed=uris.length>1;current=null;motion(false);
        logPlayback('start_timeout');
        connection('Spotify 接受播放指令，但 8 秒內沒有開始這首歌。請按播放重試'+(singleFallbackUsed?'（改用單曲模式）。':'。'));
      },8000)
    }
  }).catch(err=>{
    if(generation===playGeneration){failedGeneration=generation;singleFallbackUsed=!String(err.code||'').startsWith('device_')&&uris.length>1;current=null;motion(false);logPlayback('play_request_failed',{code:err.code||'request_failed'});if(err.code==='device_unavailable'){device=null;ready=false;showAuthUI()}connection('播放指令失敗：'+err.message+(singleFallbackUsed?'；請按播放以單曲重試。':''))}
    throw err
  });
  playCommands=job.catch(()=>{});
  return job
}
function display(state,allowRecovery=false){
  if(!state)return;
  const song=state.track_window?.current_track;
  if(!song||startedRecord!==selected.id||selected.demo)return;
  const index=selected.items.findIndex(x=>x.id===song.id||x.id===song.linked_from?.id);
  if(failedGeneration===playGeneration){
    if(!allowRecovery||state.paused||state.position<=0||index!==activeIndex)return;
    failedGeneration=-1;logPlayback('local_playback_recovered')
  }
  if(awaitingFirstTrack){if(index!==activeIndex||state.paused)return;awaitingFirstTrack=false;logPlayback('first_track_confirmed')}
  if(index<0){if(current)connection('Spotify 已切換至唱片架以外的歌曲。');current=null;motion(false);return}
  if(index!==activeIndex||song.id!==startedTrack){
    if(index>activeIndex+1)notify(`Spotify 已略過 ${index-activeIndex-1} 首曲目。`);
    activeIndex=index;startedTrack=song.id;albumEnded=false;clearTimeout(advanceTimer);
    trackStartedAt=Date.now();logPlayback('track_changed');renderQueue();
  }
  current=state;resumePoint=null;saveResume(state.paused);updateNowPlaying();
  if(state.paused&&state.position>0){clearTimeout(advanceTimer);albumEnded=false;}
  $('spotifyLink').href='https://open.spotify.com/track/'+song.id;
  $('spotifyLyricsSource').href='https://open.spotify.com/track/'+song.id;$('spotifyLyricsSource').hidden=false;
  const duration=state.duration||0,position=state.position||0;
  $('seek').disabled=!duration;$('seek').value=duration?String(Math.round(position/duration*1000)):'0';
  $('duration').textContent=format(duration/1000);$('currentTime').textContent=format(position/1000);
  setNeedle(duration?position/duration:0,true);
  window.VinylLyrics?.observe({videoId:song.id,title:song.name,artist:song.artists?.map(x=>x.name).join('、')||selected.artist,album:song.album?.name||(selected.type==='album'?selected.title:''),duration:duration/1000,time:position/1000});
  motion(!state.paused);$('status').textContent=state.paused?'已暫停':`播放中 · ${activeIndex+1} / ${selected.items.length}`;
  connection(state.paused?'此頁播放器 · 已暫停':`聲音輸出：此頁拾音室 · 第 ${activeIndex+1} / ${selected.items.length} 首`);
  lastTime=Date.now();lastPosition=position;
  if(!state.paused&&index===queueEnd&&duration>3500&&position>=duration-3200&&Date.now()-trackStartedAt>1500&&!albumEnded&&failedGeneration!==playGeneration){albumEnded=true;scheduleNextTrack()}
}
function scheduleNextTrack(){
  clearTimeout(advanceTimer);
  const own=session,recordId=selected.id,generation=playGeneration,track=startedTrack;
  advanceTimer=setTimeout(async()=>{
    if(own!==session||generation!==playGeneration||failedGeneration===generation||selected.id!==recordId||selected.demo||startedTrack!==track||!sdk)return;
    const first=await sdk.getCurrentState().catch(()=>null);
    await new Promise(resolve=>setTimeout(resolve,450));
    if(own!==session||generation!==playGeneration||selected.id!==recordId||!device)return;
    const second=await sdk.getCurrentState().catch(()=>null);
    // Spotify may already have started an autoplay recommendation after the
    // final track. That does not mean the shelf album is still playing.
    const exhausted=state=>!!state&&!userPaused&&((!state.paused&&!selected.items.some(item=>item.id===state.track_window?.current_track?.id||item.id===state.track_window?.current_track?.linked_from?.id))||(state.paused&&state.position===0&&state.track_window?.previous_tracks?.some(item=>item.id===track)));
    if(!exhausted(first)||!exhausted(second)){
      albumEnded=false;logPlayback('end_check_cancelled');return
    }
    logPlayback('album_end_confirmed');
    const mode=window.VinylModes?.value()||'sequence';
    if(mode==='single'){playTrack(activeIndex,true).catch(error);return}
    if(activeIndex+1<selected.items.length){playTrack(activeIndex+1).catch(error);return}
    const next=mode==='album'?selected:mode==='random'?(tracks.filter(x=>x.id!==recordId)[Math.floor(Math.random()*Math.max(1,tracks.length-1))]||selected):(tracks[tracks.findIndex(x=>x.id===recordId)+1]||tracks[0]);
    if(!next){await sdk.pause().catch(error);current=null;resumePoint=null;try{localStorage.removeItem(RESUME_KEY)}catch{}motion(false);$('status').textContent='唱片架已播完';connection('唱片架已全部播完，已停止播放。');return}
    select(next,false);playTrack(0).then(()=>notify('接續播放：'+next.title)).catch(error)
  },Math.max(800,(current?.duration||0)-(current?.position||0)+800))
}
function toggleDemo(){if(demoOn){demoOn=false;motion(false);$('demo').textContent='試轉唱盤';return}if(sdk)pendingPause=playCommands.catch(()=>{}).then(()=>sdk.pause()).catch(()=>{});demoOn=true;demoRatio=Number($('demoSeek').value)/1000;$('demoProgress').hidden=false;$('demo').textContent='停止試轉';motion(true);setNeedle(demoRatio,true)}
let emptyPolls=0;
setInterval(async()=>{
  if(demoOn){demoRatio=Math.min(1,demoRatio+1/240);$('demoSeek').value=Math.round(demoRatio*1000);setNeedle(demoRatio,true);if(demoRatio===1)toggleDemo();return}
  void inspectOutput();
  if(!sdk||!device||pollBusy)return;
  pollBusy=true;
  const instance=sdk;
  try{
    const state=await instance.getCurrentState();
    if(instance!==sdk)return;
    if(state){emptyPolls=0;display(state,true)}
    else if(++emptyPolls===4&&current){logPlayback('state_unavailable');current=null;motion(false);connection('Spotify 暫時沒有回報此播放器的播放狀態；可按播放重試。')}
  }catch(err){logPlayback('state_poll_failed')}
  finally{pollBusy=false}
},1500);
$('play').onclick=()=>{window.vinylArmParked=false;demoOn=false;$('demoProgress').hidden=true;if(!sdk||!device)return error(Error('請先連接 Spotify，等待播放器就緒。'));if(current?.track_window?.current_track?.id===startedTrack){const activation=sdk.activateElement();activation.then(()=>{if(!current.paused)return pauseHere();userPaused=false;return sdk.resume()}).catch(error)}else playTrack(activeIndex,singleFallbackUsed).catch(error)};
$('prev').onclick=()=>{if(!sdk)return notify('請先連接 Spotify。');if(activeIndex===0)return notify('已是這張唱片的第一首。');playTrack(activeIndex-1).catch(error)};
$('next').onclick=()=>{if(!sdk)return notify('請先連接 Spotify。');if(activeIndex+1<selected.items.length)playTrack(activeIndex+1).catch(error);else{const next=tracks[tracks.findIndex(x=>x.id===selected.id)+1]||tracks[0];if(!next)return notify('已是唱片架最後一張。');select(next,false);playTrack(0).catch(error)}};
$('seek').onchange=()=>{if(current)sdk.seek(Math.round(Number($('seek').value)/1000*current.duration)).catch(error)};
$('demo').onclick=toggleDemo;$('demoSeek').oninput=()=>{demoRatio=Number($('demoSeek').value)/1000;setNeedle(demoRatio,true)};
window.VinylPlayback={async seek({videoId,seconds}){if(!current||current.track_window?.current_track?.id!==videoId||!Number.isFinite(seconds))return {ok:false,message:'請先播放這首歌。'};try{const target=Math.min(Math.max(0,seconds),Math.max(0,current.duration/1000-.05));await sdk.seek(Math.round(target*1000));return {ok:true,seconds:target}}catch{return {ok:false,message:'目前無法跳轉，請稍後再試。'}}}};
const spotifyLyricsSource=document.createElement('a');spotifyLyricsSource.id='spotifyLyricsSource';spotifyLyricsSource.href='https://open.spotify.com/';spotifyLyricsSource.target='_blank';spotifyLyricsSource.rel='noopener noreferrer';spotifyLyricsSource.textContent='到 Spotify 看內建歌詞 ↗';spotifyLyricsSource.hidden=true;$('lyricsPanel').querySelector('.lyrics-footer').append(spotifyLyricsSource);
let lampOn=true;try{lampOn=localStorage.getItem('vinyl-room.spotify.lamp')!=='off'}catch{}
function setLamp(on){lampOn=on;$('deck').classList.toggle('lights-on',on);$('lampSwitch').setAttribute('aria-pressed',String(on));$('lampSwitch').setAttribute('aria-label',on?'關閉唱盤燈光':'開啟唱盤燈光');$('lampLabel').textContent=on?'燈光開啟':'燈光關閉'}
setLamp(lampOn);$('lampSwitch').onclick=()=>{setLamp(!lampOn);localStorage.setItem('vinyl-room.spotify.lamp',lampOn?'on':'off')};
const glowCodes=['83ecf641','b1f4fc20','f3f0d5','f3fff6','d7e8db','ffedba','8deaf355','4a7f7b26','55b5c024','f0ffff','c0f8fb','9cdee5','b5e9ed','b9dfe0','dcffff','efffff','9cf5fb55','dbffffa8','ecffffad','d6f6f3','ffffff26','e3ffff55','c2ecec','7a888c','a2dce7','69d7f4','b8c3c6','67dbeb','49d1e6'];
const lights={ice:185,lavender:265,rose:335,amber:40,mint:145,white:0,pearl:195};
function chooseLight(name){const hue=lights[name];if(hue===undefined)return;for(const hex of glowCodes){const alpha=hex.length===8?parseInt(hex.slice(6,8),16)/255:1;$('deck').style.setProperty('--glow-'+hex,name==='ice'?'#'+hex:name==='white'?`rgb(255 255 255 / ${alpha})`:`hsl(${hue} 62% 80% / ${alpha})`)}document.querySelectorAll('[data-light]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.light===name)));localStorage.setItem('vinyl-room.spotify.light',name);setLamp(true)}
for(const b of document.querySelectorAll('[data-light]'))b.onclick=()=>chooseLight(b.dataset.light);try{chooseLight(localStorage.getItem('vinyl-room.spotify.light')||'ice')}catch{}
function openAlbum(){$('spotifyAddError').textContent='';$('spotifyAddDialog').showModal()}
function openAdd(){openAlbum()}
for(const id of ['openAdd','openAlbum'])$(id).onclick=openAlbum;
$('spotifyCloseAdd').onclick=()=>$('spotifyAddDialog').close();
async function importSpotify(value){if(!auth)throw Error('請先連接 Spotify。');const u=new URL(value);const m=u.protocol==='https:'&&u.hostname==='open.spotify.com'&&u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(album|track)\/([A-Za-z0-9]{22})\/?$/);if(!m)throw Error('請貼上 Spotify 專輯或歌曲分享連結。');const [,type,id]=m;if(tracks.some(t=>t.type===type&&t.spotifyId===id))throw Error('這張收藏已經在唱片架。');if(tracks.length>=200)throw Error('收藏最多 200 張。');const data=await api((type==='album'?'albums/':'tracks/')+id);let items=type==='album'?[...data.tracks.items]:[data],next=type==='album'?data.tracks.next:null;while(next){const url=new URL(next);if(url.origin!=='https://api.spotify.com'||!url.pathname.startsWith('/v1/'))throw Error('Spotify 曲目來源有誤。');const page=await api(url.pathname.slice(4)+url.search);items.push(...page.items);next=page.next}items=items.map((x,i)=>x?{...x,position:i}:null).filter(x=>x&&SPOTIFY_ID.test(x.id||''));if(!items.length)throw Error('這個連結沒有可播放的曲目。');const t={id:makeId(),spotifyId:id,type,title:data.name,artist:data.artists.map(a=>a.name).join('、'),image:(type==='album'?data.images:data.album.images)?.[0]?.url||'',items:items.map(x=>({id:x.id,name:x.name,uri:x.uri,position:x.position})),vinylDesign:defaultVinylDesign()};pendingAlbum=t;openCover(t);$('spotifyAddDialog').close()}
$('spotifyAddForm').onsubmit=async e=>{e.preventDefault();$('spotifyAddSubmit').disabled=true;$('spotifyAddError').textContent='';try{await importSpotify($('spotifyUrl').value.trim())}catch(err){$('spotifyAddError').textContent=err.message}finally{$('spotifyAddSubmit').disabled=false}};
function configureCoverStep(t){const adding=pendingAlbum===t;$('coverDialog').classList.toggle('album-cover-step',adding);$('coverEditorHeading').textContent=adding?'調整專輯封面':'更換專輯封面';$('coverWizardStep').hidden=!adding;$('backAlbumDetails').hidden=!adding;$('skipAlbumCover').hidden=!adding;$('saveCover').textContent=adding?'完成收藏 ＋':'儲存封面';$('albumCoverStatus').hidden=!adding;$('albumCoverStatus').textContent=adding?'已讀取 Spotify 官方封面；也可上傳自己的圖片。':''}
function openCover(t){configureCoverStep(t);editingRecord=t;coverDraft=t.cover?{...t.cover}:{data:'',zoom:1,x:50,y:50};coverGeneration++;$('coverEditName').textContent=t.title;$('coverError').textContent='';syncCoverEditor();$('coverDialog').showModal()}
function syncCoverEditor(){const src=coverDraft.data||editingRecord.image;for(const id of ['coverPreviewImage','coverCircleImage']){const img=$(id);img.hidden=!src;if(src)img.src=src;else img.removeAttribute('src');applyCoverStyle(img,coverDraft)}$('coverNoImage').hidden=!!src;$('coverCircleEmpty').hidden=!!src;$('coverZoom').value=Math.round(coverDraft.zoom*100);$('coverX').value=coverDraft.x;$('coverY').value=coverDraft.y;$('coverZoomValue').textContent=Math.round(coverDraft.zoom*100)+'%';$('coverPictureNote').hidden=editingRecord?.vinylDesign?.pattern!=='image'}
function cancelCover(){coverGeneration++;$('coverDialog').close();if(pendingAlbum){pendingAlbum=null;$('spotifyAddDialog').showModal()}}
$('closeCover').onclick=cancelCover;$('backAlbumDetails').onclick=cancelCover;$('coverDialog').addEventListener('cancel',e=>{e.preventDefault();cancelCover()});
$('uploadCover').onclick=()=>$('coverFile').click();$('resetCover').onclick=()=>{coverGeneration++;coverDraft={data:'',zoom:1,x:50,y:50};syncCoverEditor()};
for(const id of ['coverZoom','coverX','coverY'])$(id).oninput=()=>{coverDraft.zoom=Number($('coverZoom').value)/100;coverDraft.x=Number($('coverX').value);coverDraft.y=Number($('coverY').value);syncCoverEditor()};
$('coverFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;const own=++coverGeneration;coverBusy=true;$('saveCover').disabled=true;let bitmap;try{if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10000000)throw Error('請選擇 10 MB 內的 JPG、PNG 或 WebP。');bitmap=await createImageBitmap(f);const scale=Math.min(1,900/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.round(bitmap.width*scale);c.height=Math.round(bitmap.height*scale);const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0,c.width,c.height);const data=c.toDataURL('image/jpeg',.82);if(data.length>650000)throw Error('圖片資料太大，請換較簡單的圖片。');if(own===coverGeneration){coverDraft={data,zoom:1,x:50,y:50};syncCoverEditor()}}catch(err){$('coverError').textContent=err.message}finally{bitmap?.close();coverBusy=false;$('saveCover').disabled=false;e.target.value=''}};
function finishCover(skip=false){if(coverBusy||!editingRecord)return;const t=editingRecord;if(pendingAlbum===t){if(!skip)t.cover={...coverDraft};tracks.unshift(t);if(!persist()){tracks.shift();$('coverError').textContent='無法儲存，請先整理收藏或圖片。';return}pendingAlbum=null;$('spotifyAddForm').reset();$('coverDialog').close();select(t);notify('專輯已收藏，按播放開始聆聽')}else{const old=t.cover;t.cover={...coverDraft};if(!persist()){t.cover=old;return}$('coverDialog').close();render();updateDisc();notify('封面已更新')}}
$('skipAlbumCover').onclick=()=>finishCover(true);$('coverForm').onsubmit=e=>{e.preventDefault();finishCover()};
$('spotifyLogin').onclick=()=>login().catch(error);$('spotifyLogout').onclick=()=>{sdk?.disconnect();sdk=null;device=null;ready=false;player=null;clearAuth();current=null;showAuthUI();motion(false);connection('已登出此頁面')};
$('copyPlaybackDiagnostics').onclick=async()=>{
  const report=JSON.stringify({version:43,events:playbackEvents},null,2);
  try{await navigator.clipboard.writeText(report);$('playbackDiagStatus').textContent='已複製，可貼給我協助排查。';$('playbackDiagText').hidden=true}
  catch{$('playbackDiagStatus').textContent='瀏覽器無法自動複製，請選取下方文字手動複製。';$('playbackDiagText').hidden=false;$('playbackDiagText').value=report}
};
$('spotifySetupOpen').onclick=()=>{$('spotifyRedirect').value=REDIRECT;$('spotifySetup').showModal()};$('spotifyCloseSetup').onclick=()=>$('spotifySetup').close();$('help').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
async function boot(){const saved=readResume();select(tracks.find(t=>t.id===saved?.recordId)||tracks[0]||emptyRecord);if(saved&&selected.id===saved.recordId){const i=selected.items.findIndex(t=>t.id===saved.trackId);if(i>=0){activeIndex=i;resumePoint={...saved,position:saved.duration>0&&saved.position>=saved.duration-1000?0:saved.position};updateNowPlaying();renderQueue();$('currentTime').textContent=format(resumePoint.position/1000);$('status').textContent='已恢復上次曲目 · 按播放接續';}}const p=new URLSearchParams(location.search);if(p.has('code')||p.has('error')){const pkce=readSession('spotify.pkce');history.replaceState({},'',location.pathname);sessionStorage.removeItem('spotify.pkce');if(p.has('error')){sessionStorage.removeItem('spotify.pending-import');throw Error('Spotify 授權未完成。')}if(!pkce||pkce.state!==p.get('state')||Date.now()-pkce.created>600000)throw Error('登入驗證已失效，請再連接 Spotify。');storeAuth(await tokenRequest({client_id:CLIENT,grant_type:'authorization_code',code:p.get('code'),redirect_uri:REDIRECT,code_verifier:pkce.verifier}),pkce.scope)}if(auth){try{await connect()}catch(err){connection('已登入 Spotify，但播放器尚未就緒：'+err.message);showAuthUI()}if(sessionStorage.getItem('spotify.pending-import')==='1'){sessionStorage.removeItem('spotify.pending-import');window.SpotifySavedLibrary?.open()}}}
boot().catch(error);

;

// 功能區段：lyrics-core.js
/* Shared, deterministic helpers for lyric matching and timed display. */
(function(root){
  const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  function cleanTitle(value){return String(value||'').replace(/\[(?:official|mv|m\/v|lyrics?|audio|visualizer|가사)[^\]]*\]/gi,'').replace(/\((?:official|music video|lyrics?|audio|visualizer)[^)]*\)/gi,'').replace(/\b(?:official\s*)?(?:music video|m\/v|mv|lyrics? video)\b/gi,'').replace(/\s+/g,' ').trim()}
  function titleAliases(value){const clean=cleanTitle(value);const quoted=[...clean.matchAll(/["'“‘]([^"'”’]+)["'”’]/g)].map(m=>m[1].trim());const parens=[...clean.matchAll(/\(([^)]+)\)/g)].map(m=>m[1].trim()).filter(x=>/[a-zA-Z]/.test(x));return [...new Set([...quoted,...parens,clean].filter(Boolean))].slice(0,4)}
  function inferSong(title,artist){let t=cleanTitle(title),a=String(artist||'').replace(/\s*[-–]\s*Topic$/i,'').replace(/VEVO$/i,'').trim();const quoted=t.match(/^(.+?)\s+["'“‘]([^"'”’]+)["'”’]/);if(quoted){if(!a)a=quoted[1].trim();t=quoted[2].trim()}else{const dash=t.match(/^(.+?)\s+[-–—]\s+(.+)$/);if(dash&&(!a||normalize(a).includes(normalize(dash[1])))){a=a||dash[1].trim();t=dash[2].trim()}}a=a.replace(/\s*\([^)]*\)\s*$/,'').trim()||a;return {title:t,artist:a}}
  function parseLRC(text){const rows=[];const offset=Number(String(text||'').match(/\[offset:([+-]?\d+)\]/i)?.[1]||0)/1000;String(text||'').split(/\r?\n/).forEach((line,index)=>{const stamps=[...line.matchAll(/\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/g)];const body=line.replace(/\[[^\]]*\]/g,'').trim();for(const m of stamps){const fraction=m[3]?Number('0.'+m[3]):0;rows.push({time:Math.max(0,Number(m[1])*60+Number(m[2])+fraction-offset),text:body,order:index})}});return rows.sort((a,b)=>a.time-b.time||a.order-b.order)}
  function activeIndex(rows,seconds,delay=0){const time=seconds-delay;let lo=0,hi=rows.length-1,result=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(rows[mid].time<=time){result=mid;lo=mid+1}else hi=mid-1}return result}
  function rankVersions(results,song){const titles=titleAliases(song.title).map(normalize);const artist=normalize(song.artist),album=normalize(song.album);return results.filter(r=>Number.isInteger(r.id)&&typeof r.trackName==='string'&&typeof r.artistName==='string').map(r=>{const rt=normalize(r.trackName),ra=normalize(r.artistName),ralbum=normalize(r.albumName);const titleMatch=titles.includes(rt)||titleAliases(r.trackName).some(t=>titles.includes(normalize(t)));const artistMatch=!!artist&&!!ra&&(artist===ra||(artist.length>=3&&ra.length>=3&&(artist.includes(ra)||ra.includes(artist))));const albumMatch=!!album&&album===ralbum;const distance=song.duration>0?Math.abs(Number(r.duration||0)-song.duration):Infinity;return {...r,titleMatch,artistMatch,albumMatch,distance,score:(titleMatch?100:0)+(artistMatch?40:0)+(albumMatch?25:0)+(r.syncedLyrics?5:0)+(Number.isFinite(distance)?Math.max(0,20-distance):0)}}).sort((a,b)=>b.score-a.score||a.distance-b.distance)}
  function credibleVersion(v,song){return !!v?.titleMatch&&!!v?.artistMatch&&(!song.duration||v.distance<=Math.max(8,Math.min(12,song.duration*.04)))}
  function canAutoSelect(version,song){return credibleVersion(version,song)}
  function autoVersion(versions,song){const matches=rankVersions(versions,song).filter(v=>canAutoSelect(v,song));return matches.find(v=>parseLRC(v.syncedLyrics).some(row=>row.text&&row.time>0))||matches[0]||null}
  const api={normalize,cleanTitle,titleAliases,inferSong,parseLRC,activeIndex,rankVersions,credibleVersion,canAutoSelect,autoVersion};root.VinylLyricsCore=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

;

// 功能區段：lyrics.js
/* Lyrics are fetched from LRCLIB in the visitor's browser; no audio extraction. */
(function(){
'use strict';
const $=id=>document.getElementById(id),core=window.VinylLyricsCore;
const PREF='vinyl-room.lyrics-settings.v1';
let settings={};try{const stored=JSON.parse(localStorage.getItem(PREF)||'{}');if(stored&&typeof stored==='object'&&!Array.isArray(stored))settings=stored}catch{}
let current=null,controller=null,generation=0,versions=[],rows=[],active=-2,delay=0,lastTime=0,loaded=false,lastDuration=0,chosenManually=false,queryManually=false,calibrating=false;
function remember(){if(!current)return;const old=settings[current.videoId]||{};settings[current.videoId]={...old,offset:delay};try{localStorage.setItem(PREF,JSON.stringify(Object.fromEntries(Object.entries(settings).slice(-500))))}catch{}}
function displayOffset(){ $('lyricsOffset').textContent=delay===0?'0 秒':`${delay>0?'延後':'提前'} ${Math.abs(delay).toFixed(1)} 秒` }
function message(text,type='自動搜尋'){$('lyricsStatus').textContent=text;$('lyricsType').textContent=type;if(['請選版本','請確認版本','尚未找到','連線失敗'].includes(type)&&$('lyricsSettings')){$('lyricsSettings').open=true;$('lyricsSettings').dataset.autoOpened='1'}}
function clearContent(text){$('lyricsWindow').replaceChildren();const p=document.createElement('p');p.className='lyrics-empty';p.textContent=text;$('lyricsWindow').append(p)}
function reset(){generation++;controller?.abort();controller=null;current=null;versions=[];rows=[];active=-2;loaded=false;chosenManually=false;queryManually=false;setCalibration(false);lastDuration=0;lastTime=0;delay=0;$('lyricsSong').value='';$('lyricsArtist').value='';$('lyricsControls').hidden=true;$('lyricsMatch').textContent='';$('findLyrics').disabled=false;$('findLyrics').textContent='搜尋歌詞';message('選一首歌，歌詞會自動出現在這裡。');clearContent('留一點空白，等喜歡的聲音。');displayOffset()}
let serviceUntil=0;
function waitLyrics(ms,signal){return new Promise((resolve,reject)=>{if(signal.aborted)return reject(Error('cancelled'));const abort=()=>{clearTimeout(timer);reject(Error('cancelled'))};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms);signal.addEventListener('abort',abort,{once:true})})}
async function requestLyrics(endpoint,signal){
 if(Date.now()<serviceUntil)throw Error('rate_limit');
 for(let attempt=0;attempt<2;attempt++){
  const local=new AbortController(),abort=()=>local.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)local.abort();const timer=setTimeout(abort,8000);
  try{const response=await fetch(endpoint,{signal:local.signal,credentials:'omit',headers:{'Lrclib-Client':'VinylRoom/1.0'}});
   if(response.status===404)return null;
   if(response.status===429){const value=response.headers.get('Retry-After');const seconds=Number(value);serviceUntil=Date.now()+Math.max(1000,value&&Number.isFinite(seconds)?seconds*1000:(Date.parse(value)-Date.now())||60000);throw Error('rate_limit')}
   if(!response.ok)throw Error('service');return await response.json();
  }catch(err){if(signal.aborted||err.message==='rate_limit'||attempt===1)throw err}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort)}
  await waitLyrics(700,signal);
 }
}
async function fetchSearch(params,signal){const endpoint=new URL('https://lrclib.net/api/search');for(const [key,value] of Object.entries(params))if(value)endpoint.searchParams.set(key,value);const result=await requestLyrics(endpoint,signal);if(!Array.isArray(result))throw Error('data');return result.slice(0,100)}
async function fetchExact(input,album,duration,signal){if(!input.artist||!duration)return null;const endpoint=new URL('https://lrclib.net/api/get');for(const [key,value] of Object.entries({track_name:input.title,artist_name:input.artist,album_name:album,duration:Math.round(duration)}))if(value)endpoint.searchParams.set(key,value);return requestLyrics(endpoint,signal)}
function songInput(){return core.inferSong($('lyricsSong').value.trim(),$('lyricsArtist').value.trim())}
async function search(manual=false){if(!current)return;if(manual)queryManually=true;chosenManually=false;setCalibration(false);const input=songInput();if(!input.title){message('請填寫歌名後搜尋。');return}controller?.abort();controller=new AbortController();const own=++generation,signal=controller.signal,videoId=current.videoId;loaded=false;rows=[];active=-2;$('lyricsControls').hidden=true;$('lyricsCalibrate').disabled=true;$('lyricsMatch').textContent='';$('findLyrics').disabled=true;$('findLyrics').textContent='搜尋中…';message('正在尋找這首歌的歌詞…');clearContent('搜尋中，音樂會繼續播放。');const duration=current.duration||0,album=current.album||'';let results=[],hadResponse=false;
try{const context={...input,album,duration};try{const exact=await fetchExact(input,album,duration,signal);if(input.artist&&duration)hadResponse=true;if(exact)results.push(exact)}catch(err){if(signal.aborted)return}{const aliases=core.titleAliases(input.title);for(const title of aliases.slice(0,3)){if(signal.aborted||own!==generation)return;try{await waitLyrics(250,signal);const data=await fetchSearch(input.artist?{track_name:title,artist_name:input.artist}:{q:title},signal);hadResponse=true;results.push(...data);if(results.length>=150)break}catch(error){if(signal.aborted)return;if(error.message==='rate_limit')break}}}if(!core.autoVersion(results,context)?.syncedLyrics&&input.artist&&Date.now()>=serviceUntil){try{await waitLyrics(250,signal);results.push(...await fetchSearch({track_name:input.title},signal));hadResponse=true}catch(err){if(signal.aborted)return}}if(own!==generation||current?.videoId!==videoId)return;if(!hadResponse)throw Error('network');const unique=[...new Map(results.filter(r=>Number.isInteger(r?.id)).map(r=>[r.id,r])).values()];versions=core.rankVersions(unique,context).filter(r=>r.titleMatch&&(r.syncedLyrics||r.plainLyrics||r.instrumental)).slice(0,100);if(!versions.length){message('LRCLIB 沒有找到歌名、歌手與長度吻合的歌詞；不會顯示其他歌曲。','尚未找到');clearContent('暫時沒有可靠的歌詞版本，可到 Spotify 查看這首歌。');return}const select=$('lyricsVersion');select.replaceChildren();const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='請選擇相符的歌曲版本';select.append(placeholder);for(const v of versions){const o=document.createElement('option');o.value=String(v.id);o.textContent=`${v.artistName} — ${v.trackName} · ${v.albumName||'未標示專輯'} · ${clock(v.duration)}${Number.isFinite(v.distance)?'（差 '+Math.round(v.distance)+' 秒）':''} · ${v.instrumental?'純音樂':v.syncedLyrics?'同步歌詞':'文字歌詞'}`;select.append(o)}$('lyricsControls').hidden=false;const saved=settings[videoId];const preferred=versions.find(v=>v.id===saved?.versionId&&core.canAutoSelect(v,context));const best=core.autoVersion(versions,context);const top=preferred&&(saved?.manual||core.parseLRC(preferred.syncedLyrics).length)?preferred:best;if(top){select.value=String(top.id);useVersion(top)}else{message(duration>0?'找到多個相近版本，無法可靠區分；請確認歌詞版本。':'等待曲目長度以確認版本；也可以先手動選擇。','請選版本');clearContent('請確認上方的歌手、曲名與時間長度，再選擇版本。')}loaded=true;lastDuration=duration;
}catch(error){if(signal.aborted||own!==generation)return;message('歌詞服務暫時無法連線，自動重試後仍未成功；請稍後再試。','連線失敗');clearContent('歌詞載入失敗，音樂播放不受影響。')}
finally{if(own===generation){$('findLyrics').disabled=false;$('findLyrics').textContent='搜尋歌詞'}}}
function clock(seconds){const n=Math.max(0,Math.round(Number(seconds)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`}
function useVersion(version,manual=false){if(!manual&&!core.credibleVersion(version,{...songInput(),album:current?.album||'',duration:current?.duration||0})){message('這個版本與歌曲資訊不符，請重新搜尋。','請確認版本');return}if(!manual&&$('lyricsSettings')?.dataset.autoOpened){$('lyricsSettings').open=false;delete $('lyricsSettings').dataset.autoOpened;}setCalibration(false);chosenManually=manual;if(current)window.dispatchEvent(new CustomEvent('vinyl-lyrics-match',{detail:{videoId:current.videoId,title:version.trackName,artist:version.artistName,album:version.albumName||''}}));rows=core.parseLRC(version.syncedLyrics||'');active=-2;$('lyricsWindow').replaceChildren();$('lyricsWindow').scrollTop=0;$('lyricsMatch').textContent=`${version.artistName} · ${version.trackName} · ${clock(version.duration)}`;if(current){settings[current.videoId]={...(settings[current.videoId]||{}),versionId:version.id,manual:manual||!!(settings[current.videoId]?.manual&&settings[current.videoId]?.versionId===version.id)};remember()}if(version.instrumental){message('此版本標記為純音樂，沒有歌詞。','純音樂');clearContent('讓旋律自己說話。');return}if(rows.length){message('已自動選用最符合的歌詞；若版本或時間不對，可在下方更換或校正。','同步歌詞');rows.forEach((line,i)=>{const p=document.createElement('button');p.type='button';p.className='lyric-line';p.dataset.line=String(i);p.textContent=line.text||'♪';p.title='跳至 '+clock(line.time+delay);p.setAttribute('aria-label','播放 '+clock(line.time+delay)+' 的歌詞');p.onclick=()=>seekLyric(line);$('lyricsWindow').append(p)});tick(lastTime)}else{message('已搜尋相符版本，目前只有文字歌詞，尚無可用的逐句時間標記。','文字歌詞');const p=document.createElement('p');p.className='plain-lyrics';p.textContent=String(version.plainLyrics||'暫無歌詞');$('lyricsWindow').append(p)}$('lyricsEarlier').disabled=!rows.length;$('lyricsLater').disabled=!rows.length;$('lyricsReset').disabled=!rows.length;$('lyricsCalibrate').disabled=!rows.length}
function tick(seconds){lastTime=Number(seconds)||0;if(!rows.length)return;const index=core.activeIndex(rows,lastTime,delay);if(index===active)return;const container=$('lyricsWindow');const previous=container.querySelector('.is-current');previous?.classList.remove('is-current');previous?.removeAttribute('aria-current');active=index;const line=index>=0?container.children[index]:null;if(line){line.classList.add('is-current');line.setAttribute('aria-current','true');if($('lyricsFollow').checked&&!$('lyricsContent').hidden){const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;container.scrollTo({top:Math.max(0,line.offsetTop-container.clientHeight*.42),behavior:reduce?'auto':'smooth'})}}}
function observe(info){if(!info?.videoId)return;if(!current||current.videoId!==info.videoId){reset();const inferred=core.inferSong(info.title,info.artist);current={...info};const saved=settings[info.videoId];delay=Number.isFinite(saved?.offset)?Math.max(-60,Math.min(60,saved.offset)):0;displayOffset();$('lyricsSong').value=inferred.title;$('lyricsArtist').value=inferred.artist;if(inferred.title)search();else message('正在等待歌曲資訊…');return}
 const before=core.inferSong(current.title,current.artist),after=core.inferSong(info.title,info.artist);current={...current,...info};
 if(!queryManually&&(core.normalize(before.title)!==core.normalize(after.title)||core.normalize(before.artist)!==core.normalize(after.artist))){$('lyricsSong').value=after.title;$('lyricsArtist').value=after.artist;search();}
 else if(loaded&&lastDuration===0&&info.duration>0){lastDuration=info.duration;const context={...songInput(),album:current.album||'',duration:info.duration};versions=core.rankVersions(versions,context).filter(v=>core.credibleVersion(v,context));const best=core.autoVersion(versions,context);if(best&&!chosenManually){$('lyricsVersion').value=String(best.id);useVersion(best)}else if(!chosenManually){rows=[];active=-2;$('lyricsVersion').value='';message('歌詞版本與影片長度不夠吻合，請確認版本後再選擇。','請選版本');clearContent('請先選擇符合這首歌曲的歌詞版本。');}}
 tick(info.time)}
$('lyricsSearch').onsubmit=e=>{e.preventDefault();search(true)};$('lyricsVersion').onchange=()=>{const version=versions.find(v=>String(v.id)===$('lyricsVersion').value);if(version)useVersion(version,true)};
function shift(amount){delay=Math.round(Math.max(-60,Math.min(60,delay+amount))*2)/2;displayOffset();remember();$('lyricsWindow').querySelectorAll('.lyric-line').forEach((button,i)=>{button.title='跳至 '+clock(rows[i].time+delay);button.setAttribute('aria-label','播放 '+clock(rows[i].time+delay)+' 的歌詞')});active=-2;tick(lastTime)}$('lyricsEarlier').onclick=()=>shift(-.5);$('lyricsLater').onclick=()=>shift(.5);$('lyricsReset').onclick=()=>shift(-delay);
$('toggleLyrics').onclick=()=>{const content=$('lyricsContent'),open=content.hidden;content.hidden=!open;$('toggleLyrics').setAttribute('aria-expanded',String(open));$('toggleLyrics').textContent=open?'收合歌詞 −':'展開歌詞 ＋';if(open){active=-2;tick(lastTime)}};
$('lyricsFollow').onchange=()=>{active=-2;tick(lastTime)};
async function seekLyric(line){if(!current)return;if(calibrating){const wanted=lastTime-line.time;if(Math.abs(wanted)>60){message('時間差超過 60 秒，可能選到其他版本，請先確認歌詞版本。','請確認版本');return}shift(Math.round(wanted*2)/2-delay);setCalibration(false);message('已將這一句對齊目前播放位置，校正會記住於此影片。','已校正時間');return}const id=current.videoId,own=generation;const target=Math.max(0,line.time+delay);const result=await window.VinylPlayback?.seek({videoId:id,seconds:target});if(own!==generation||current?.videoId!==id)return;if(result?.ok){tick(result.seconds);message('已跳至 '+clock(result.seconds)+'，點擊其他句子可繼續跳轉。','同步歌詞')}else message(result?.message||'播放器尚未準備好，請稍後再點一次。','同步歌詞')}
function setCalibration(on){calibrating=on;$('lyricsCalibrate').setAttribute('aria-pressed',String(on));$('lyricsCalibrate').textContent=on?'取消對齊':'對齊目前播放';$('lyricsWindow').classList.toggle('lyrics-calibrating',on)}
$('lyricsCalibrate').onclick=()=>{setCalibration(!calibrating);message(calibrating?'等音樂唱到某一句時，點擊該句歌詞，將它對齊當下播放時間。':'已取消對齊；點歌詞可跳轉播放。','同步歌詞')};
window.VinylLyrics={reset,observe,tick};
})();

;

// 功能區段：room.js
'use strict';
(() => {
 let focusId=tracks[0]?.id||null, mode='library';
 const stage=$('crateStage');
 const artworkSrc=t=>t?.cover?.data||t?.image||'';
 function showVideo(){}
 function artwork(t){const src=artworkSrc(t);document.body.style.setProperty('--room-art',src?`url("${src}")`:'none');let hash=0;for(const c of t?.title||'')hash=(hash*31+c.charCodeAt(0))|0;document.body.style.setProperty('--room-hue',String(Math.abs(hash)%360));}
 function show(view){if(view==='player'&&selected.demo){openAdd();return}
 mode=view;const library=view==='library';$('libraryView').hidden=!library;$('playerView').hidden=library;document.body.classList.toggle('library-mode',library);document.body.classList.toggle('player-mode',!library);$('showLibrary').toggleAttribute('aria-current',library);$('showPlayer').toggleAttribute('aria-current',!library);if(library)artwork(tracks.find(t=>t.id===focusId));else artwork(selected);window.scrollTo({top:0,behavior:'instant'});}
 let position=0,targetPosition=0,animation=0,snapTimer=null,stageDrag=null,ignoreStageClickUntil=0,mountedCenter=-1,captionId=null;
 const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 const clampPosition=value=>Math.max(0,Math.min(Math.max(0,tracks.length-1),value));
 function caption(index,force=false){const focused=tracks[index];if(!force&&captionId===(focused?.id||null))return;captionId=focused?.id||null;focusId=captionId;$('crateTitle').textContent=focused?.title||'你的下一張唱片';$('crateArtist').textContent=focused?.artist||'收藏喜歡的專輯，從這裡開始。';$('cratePosition').textContent=focused?`RECORD ${String(index+1).padStart(2,'0')} / ${String(tracks.length).padStart(2,'0')}`:'YOUR PERSONAL COLLECTION';$('openFocused').textContent=focused?'放上唱盤 ↗':'＋ 加入 Spotify 專輯／歌曲';$('cratePrev').disabled=!focused||index===0;$('crateNext').disabled=!focused||index===tracks.length-1;document.querySelectorAll('#shelf .album').forEach((el,i)=>{el.classList.toggle('browsing',i===index);el.querySelector('.album-select')?.setAttribute('aria-pressed',String(i===index))});if(mode==='library')artwork(focused);}
 function mount(center,force=false){if(!force&&mountedCenter===center)return;mountedCenter=center;const previous=new Map([...stage.querySelectorAll('.crate-sleeve')].map(el=>[el.dataset.id,el]));stage.querySelector('.crate-empty')?.remove();
 for(let i=Math.max(0,center-5);i<=Math.min(tracks.length-1,center+5);i++){const t=tracks[i];let b=previous.get(t.id);previous.delete(t.id);if(!b){b=document.createElement('button');b.className='crate-sleeve';stage.append(b)}b.dataset.id=t.id;b.dataset.index=String(i);b.style.setProperty('--sleeve-hue',String((i*61+24)%360));
 if(force||!b.firstChild){b.replaceChildren();const face=document.createElement('span');face.className='sleeve-face';const fallback=document.createElement('div');fallback.className='sleeve-fallback';const brand=document.createElement('small');brand.textContent='拾音室 / PERSONAL COLLECTION';const name=document.createElement('strong');name.textContent=t.title;const artist=document.createElement('span');artist.textContent=t.artist||'SPOTIFY COLLECTION';fallback.append(brand,name,artist);face.append(fallback);const src=artworkSrc(t);if(src){const img=document.createElement('img');img.src=src;img.alt=t.title+' 封面';img.draggable=false;applyCoverStyle(img,t.cover);img.onerror=()=>img.remove();face.append(img)}const edge=document.createElement('span');edge.className='sleeve-edge';edge.textContent=String(i+1).padStart(2,'0')+' / '+t.title;face.append(edge);b.append(face);for(const side of ['right','top','bottom']){const edgeFace=document.createElement('span');edgeFace.className='sleeve-solid-edge sleeve-solid-'+side;edgeFace.setAttribute('aria-hidden','true');b.append(edgeFace)}}
 b.onclick=()=>{if(Date.now()<ignoreStageClickUntil)return;const index=tracks.findIndex(x=>x.id===t.id);if(Math.abs(index-position)<.5)open(t);else focus(t.id)};}
 for(const el of previous.values())el.remove();}
 function paint(){if(!tracks.length)return;const center=Math.round(position);mount(center);for(const b of stage.querySelectorAll('.crate-sleeve')){const index=Number(b.dataset.index),d=index-position,a=Math.abs(d),focused=index===center;const y=d>=0?-(90*a+55*Math.min(a,1)):(110*a+70*Math.min(a,1));const pitch=d>=0?Math.min(50,d*32):Math.max(-55,d*38);const z=95*Math.max(0,1-a)-70*a;b.style.setProperty('--file-y',y.toFixed(2)+'px');b.style.setProperty('--file-z',z.toFixed(2)+'px');b.style.setProperty('--file-pitch',pitch.toFixed(2)+'deg');b.style.setProperty('--file-opacity',String(Math.max(0,Math.min(1,5-a))));b.style.zIndex=String(100-Math.round(a*10));b.classList.toggle('is-focused',focused);b.setAttribute('aria-label',(focused?'放上唱盤：':'翻選：')+tracks[index].title);b.setAttribute('aria-pressed',String(focused));b.tabIndex=a<3?0:-1;if(a>4.5)b.setAttribute('aria-hidden','true');else b.removeAttribute('aria-hidden')}caption(center);}
 function tickAnimation(){position+=(targetPosition-position)*.2;if(Math.abs(targetPosition-position)<.002){position=targetPosition;animation=0;paint();return}paint();animation=requestAnimationFrame(tickAnimation)}
 function animateTo(value){targetPosition=clampPosition(value);if(reducedMotion()){cancelAnimationFrame(animation);animation=0;position=targetPosition;paint();return}if(!animation)animation=requestAnimationFrame(tickAnimation)}
 function focus(id){const index=tracks.findIndex(t=>t.id===id);if(index<0)return;clearTimeout(snapTimer);animateTo(index)}
 function flip(dir){if(!tracks.length)return;focus(tracks[clampPosition(Math.round(targetPosition)+dir)].id)}
 function open(t){if(!t)return openAlbum();sdk?.activateElement().catch(()=>{});const enter=()=>{if(!tracks.some(x=>x.id===t.id))return;window.vinylManualPlacement=true;try{if(selected.id!==t.id)select(t);show('player')}finally{window.vinylManualPlacement=false}$('backToCrate').focus({preventScroll:true});window.VinylPlacement?.play(t)};if(window.VinylSleeve)window.VinylSleeve.open(t,enter);else enter()}
 function draw(){cancelAnimationFrame(animation);animation=0;clearTimeout(snapTimer);if(!tracks.some(t=>t.id===focusId))focusId=tracks[0]?.id||null;const index=Math.max(0,tracks.findIndex(t=>t.id===focusId));position=targetPosition=index;mountedCenter=-1;captionId=null;
 if(!tracks.length){stage.replaceChildren();const empty=document.createElement('button');empty.className='crate-empty';empty.innerHTML='<span>＋</span><strong>留一個位置，給喜歡的音樂。</strong><small>收藏你的第一張專輯</small>';empty.onclick=openAlbum;stage.append(empty);caption(-1,true);return}mount(index,true);paint();caption(index,true)}
 $('showLibrary').onclick=$('backToCrate').onclick=()=>show('library');$('showPlayer').onclick=()=>show('player');$('cratePrev').onclick=()=>flip(-1);$('crateNext').onclick=()=>flip(1);$('openFocused').onclick=()=>open(tracks.find(t=>t.id===focusId));$('playerCover').onclick=()=>{if(!selected.demo)openCover(selected)};
 stage.addEventListener('keydown',e=>{if(['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.key)){e.preventDefault();flip(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1)}else if(e.key==='Enter'&&e.target===stage)open(tracks.find(t=>t.id===focusId));});
 stage.addEventListener('wheel',e=>{if(tracks.length<2)return;e.preventDefault();const raw=Math.abs(e.deltaY)>Math.abs(e.deltaX)?e.deltaY:e.deltaX;const delta=raw*(e.deltaMode===1?16:e.deltaMode===2?120:1);animateTo(targetPosition+Math.max(-180,Math.min(180,delta))*.006);clearTimeout(snapTimer);snapTimer=setTimeout(()=>animateTo(Math.round(targetPosition)),140)},{passive:false});
 stage.addEventListener('pointerdown',e=>{if(e.button!==0||!tracks.length)return;clearTimeout(snapTimer);cancelAnimationFrame(animation);animation=0;targetPosition=position;stageDrag={id:e.pointerId,y:e.clientY,base:position,active:false}});
 stage.addEventListener('pointermove',e=>{const drag=stageDrag;if(!drag||drag.id!==e.pointerId)return;if(!drag.active){if(Math.abs(e.clientY-drag.y)<7)return;drag.active=true;stage.setPointerCapture(e.pointerId);stage.classList.add('is-flipping')}e.preventDefault();ignoreStageClickUntil=Date.now()+400;position=targetPosition=clampPosition(drag.base+(e.clientY-drag.y)/150);paint()},{passive:false});
 function endFlip(e){if(!stageDrag||stageDrag.id!==e.pointerId)return;const drag=stageDrag;stageDrag=null;stage.classList.remove('is-flipping');if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);if(drag.active){ignoreStageClickUntil=Date.now()+400;animateTo(Math.round(position))}}
 stage.addEventListener('pointerup',endFlip);stage.addEventListener('pointercancel',endFlip);stage.addEventListener('dragstart',e=>e.preventDefault());
 window.VinylRoomUI={showLibrary:()=>show('library'),render:draw,focus,artwork,showVideo,select(t){focusId=t.demo?null:t.id;draw();if(!t.demo)show('player');else show('library')}};
 draw();show('library');
})();

;

// 功能區段：vinyl-material-core.js
'use strict';
// Procedural resin texture: no product photographs or artwork are embedded.
globalThis.VinylMaterialCore=(()=>{
const cache=new Map(),clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
function rng(seed){return ()=>{seed|=0;seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296}}
function noiseFactory(random){const grid=Float32Array.from({length:16384},()=>random());return (x,y)=>{const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,s=u*u*(3-2*u),t=v*v*(3-2*v);const at=(a,b)=>grid[((a&127)+((b&127)<<7))];return (at(i,j)*(1-s)+at(i+1,j)*s)*(1-t)+(at(i,j+1)*(1-s)+at(i+1,j+1)*s)*t}}
const rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
function render(d,size=640){const key=JSON.stringify([d.color,d.accent,d.pattern,d.opacity,d.amount,d.seed,d.translucent,size]);if(cache.has(key))return cache.get(key);const random=rng(d.seed||1847),n=noiseFactory(random),fb=(x,y)=>n(x,y)*.57+n(x*2.03+17,y*2.03+9)*.28+n(x*4.1+31,y*4.1)*.15;
const canvas=(typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(size,size):document.createElement('canvas'));canvas.width=canvas.height=size;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(size,size),a=rgb(d.color),b=rgb(d.accent),op=clamp((d.opacity??65)/100),amount=clamp((d.amount??60)/100),half=size/2;
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const u=(x-half)/half,v=(y-half)/half,r=Math.hypot(u,v),i=(y*size+x)*4;if(r>1)continue;const nx=u*1.8+12,ny=v*1.8+24;const w=fb(nx,ny),z=fb(nx+40,ny+30);const cloud=fb(nx+w*2.7,ny+z*2.7);let mix=0,alpha=.12+op*.83;
if(d.pattern==='marble'){const smoke=fb(nx*.7+w*2.4,ny*4.8+z*5.4),fibers=fb(nx*1.3+w*4.5,ny*15+z*14);mix=clamp((Math.pow(smooth(.23,.79,smoke*.67+cloud*.33),2.5)*1.8+Math.pow(smooth(.48,.83,fibers),3)*.35)*amount*1.65);alpha=clamp(.13+op*.8+mix*.1)}
if(d.pattern==='splatter'){mix=smooth(.44,.68,cloud)*.18*amount;alpha=.08+op*.7+cloud*.07}
if(d.pattern==='split'){const boundary=v+.018*Math.sin(u*7+2)+.007*(cloud-.5);mix=smooth(-.008,.008,boundary);alpha=.07+op*.65+mix*.24}
const grain=(random()-.5)*3.8,shade=1-r*r*.07+(cloud-.5)*.06;for(let k=0;k<3;k++)pixels.data[i+k]=clamp((a[k]*(1-mix)+b[k]*mix)*shade+grain,0,255);pixels.data[i+3]=Math.round((d.translucent===false?1:clamp(alpha))*255*(1-smooth(.992,1,r)));}
ctx.putImageData(pixels,0,0);
ctx.save();ctx.beginPath();ctx.arc(half,half,half-1,0,Math.PI*2);ctx.clip();
if(d.pattern==='splatter'){
// Each pellet stretches radially under pressure, with independent size, curvature and length.
for(let k=0;k<Math.round(amount*850);k++){const angle=random()*Math.PI*2,start=k%4===0?.22+random()*.19:.24+random()*.73,length=k%4===0?.15+random()*.42:.006+Math.pow(random(),2)*(.08+amount*.20),width=(.002+Math.pow(random(),2)*.017)*size;const ink=k%5===0?a:b;ctx.save();ctx.translate(half,half);ctx.rotate(angle);ctx.fillStyle=`rgba(${ink.join(',')},${.58+random()*.4})`;const from=start*half,to=Math.min(.995,start+length)*half,drift=(random()-.5)*size*.018;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(from,0);ctx.bezierCurveTo(from+(to-from)*.3,-width*.6,to-(to-from)*.2,drift+width*.4,to,drift);ctx.stroke();ctx.restore()}
}
// Mastering bands alternate fine grooves and narrow gaps; restrained highlights avoid a painted look.
ctx.lineWidth=.55;for(let r=half*.34;r<half*.98;r+=1.7){ctx.beginPath();ctx.arc(half,half,r,0,Math.PI*2);ctx.strokeStyle=`rgba(10,25,30,${.035+random()*.06})`;ctx.stroke();ctx.beginPath();ctx.arc(half,half,r+.65,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.11)';ctx.stroke()}
for(const r of [.38,.53,.72,.89]){ctx.beginPath();ctx.arc(half,half,half*r,0,Math.PI*2);ctx.strokeStyle='rgba(12,25,27,.09)';ctx.lineWidth=1.2;ctx.stroke()}
const light=ctx.createLinearGradient(0,size,size,0);light.addColorStop(0,'#ffffff00');light.addColorStop(.31,'#ffffff00');light.addColorStop(.39,'#ffffff25');light.addColorStop(.44,'#ffffff08');light.addColorStop(.49,'#ffffff00');light.addColorStop(.78,'#ffffff14');light.addColorStop(1,'#ffffff00');ctx.fillStyle=light;ctx.fillRect(0,0,size,size);ctx.restore();cache.set(key,canvas);if(cache.size>5)cache.delete(cache.keys().next().value);return canvas}
return {render};
})();

;

// 功能區段：vinyl-material.js
'use strict';
window.VinylMaterial=(()=>{
const cache=new Map();let worker=null,busy=false,nextId=0,queue=[],active=null;
try{worker=new Worker(URL.createObjectURL(new Blob(["'use strict';\n// Procedural resin texture: no product photographs or artwork are embedded.\nglobalThis.VinylMaterialCore=(()=>{\nconst cache=new Map(),clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));\nconst smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};\nfunction rng(seed){return ()=>{seed|=0;seed=seed+0x6d2b79f5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296}}\nfunction noiseFactory(random){const grid=Float32Array.from({length:16384},()=>random());return (x,y)=>{const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,s=u*u*(3-2*u),t=v*v*(3-2*v);const at=(a,b)=>grid[((a&127)+((b&127)<<7))];return (at(i,j)*(1-s)+at(i+1,j)*s)*(1-t)+(at(i,j+1)*(1-s)+at(i+1,j+1)*s)*t}}\nconst rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));\nfunction render(d,size=640){const key=JSON.stringify([d.color,d.accent,d.pattern,d.opacity,d.amount,d.seed,d.translucent,size]);if(cache.has(key))return cache.get(key);const random=rng(d.seed||1847),n=noiseFactory(random),fb=(x,y)=>n(x,y)*.57+n(x*2.03+17,y*2.03+9)*.28+n(x*4.1+31,y*4.1)*.15;\nconst canvas=(typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(size,size):document.createElement('canvas'));canvas.width=canvas.height=size;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(size,size),a=rgb(d.color),b=rgb(d.accent),op=clamp((d.opacity??65)/100),amount=clamp((d.amount??60)/100),half=size/2;\nfor(let y=0;y<size;y++)for(let x=0;x<size;x++){const u=(x-half)/half,v=(y-half)/half,r=Math.hypot(u,v),i=(y*size+x)*4;if(r>1)continue;const nx=u*1.8+12,ny=v*1.8+24;const w=fb(nx,ny),z=fb(nx+40,ny+30);const cloud=fb(nx+w*2.7,ny+z*2.7);let mix=0,alpha=.12+op*.83;\nif(d.pattern==='marble'){const smoke=fb(nx*.7+w*2.4,ny*4.8+z*5.4),fibers=fb(nx*1.3+w*4.5,ny*15+z*14);mix=clamp((Math.pow(smooth(.23,.79,smoke*.67+cloud*.33),2.5)*1.8+Math.pow(smooth(.48,.83,fibers),3)*.35)*amount*1.65);alpha=clamp(.13+op*.8+mix*.1)}\nif(d.pattern==='splatter'){mix=smooth(.44,.68,cloud)*.18*amount;alpha=.08+op*.7+cloud*.07}\nif(d.pattern==='split'){const boundary=v+.018*Math.sin(u*7+2)+.007*(cloud-.5);mix=smooth(-.008,.008,boundary);alpha=.07+op*.65+mix*.24}\nconst grain=(random()-.5)*3.8,shade=1-r*r*.07+(cloud-.5)*.06;for(let k=0;k<3;k++)pixels.data[i+k]=clamp((a[k]*(1-mix)+b[k]*mix)*shade+grain,0,255);pixels.data[i+3]=Math.round((d.translucent===false?1:clamp(alpha))*255*(1-smooth(.992,1,r)));}\nctx.putImageData(pixels,0,0);\nctx.save();ctx.beginPath();ctx.arc(half,half,half-1,0,Math.PI*2);ctx.clip();\nif(d.pattern==='splatter'){\n// Each pellet stretches radially under pressure, with independent size, curvature and length.\nfor(let k=0;k<Math.round(amount*850);k++){const angle=random()*Math.PI*2,start=k%4===0?.22+random()*.19:.24+random()*.73,length=k%4===0?.15+random()*.42:.006+Math.pow(random(),2)*(.08+amount*.20),width=(.002+Math.pow(random(),2)*.017)*size;const ink=k%5===0?a:b;ctx.save();ctx.translate(half,half);ctx.rotate(angle);ctx.fillStyle=`rgba(${ink.join(',')},${.58+random()*.4})`;const from=start*half,to=Math.min(.995,start+length)*half,drift=(random()-.5)*size*.018;ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(from,0);ctx.bezierCurveTo(from+(to-from)*.3,-width*.6,to-(to-from)*.2,drift+width*.4,to,drift);ctx.stroke();ctx.restore()}\n}\n// Mastering bands alternate fine grooves and narrow gaps; restrained highlights avoid a painted look.\nctx.lineWidth=.55;for(let r=half*.34;r<half*.98;r+=1.7){ctx.beginPath();ctx.arc(half,half,r,0,Math.PI*2);ctx.strokeStyle=`rgba(10,25,30,${.035+random()*.06})`;ctx.stroke();ctx.beginPath();ctx.arc(half,half,r+.65,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,.11)';ctx.stroke()}\nfor(const r of [.38,.53,.72,.89]){ctx.beginPath();ctx.arc(half,half,half*r,0,Math.PI*2);ctx.strokeStyle='rgba(12,25,27,.09)';ctx.lineWidth=1.2;ctx.stroke()}\nconst light=ctx.createLinearGradient(0,size,size,0);light.addColorStop(0,'#ffffff00');light.addColorStop(.31,'#ffffff00');light.addColorStop(.39,'#ffffff25');light.addColorStop(.44,'#ffffff08');light.addColorStop(.49,'#ffffff00');light.addColorStop(.78,'#ffffff14');light.addColorStop(1,'#ffffff00');ctx.fillStyle=light;ctx.fillRect(0,0,size,size);ctx.restore();cache.set(key,canvas);if(cache.size>5)cache.delete(cache.keys().next().value);return canvas}\nreturn {render};\n})();\n\n;\n'use strict';\n\nself.onmessage=async({data:{id,design,size}})=>{try{const canvas=VinylMaterialCore.render(design,size);const blob=await canvas.convertToBlob({type:'image/png'});self.postMessage({id,blob})}catch(e){self.postMessage({id,error:e.message})}};\n"],{type:"text/javascript"})))}catch{}
function advance(){if(busy||!queue.length)return;busy=true;active=queue.shift();worker.postMessage({id:active.id,design:active.design,size:active.size})}
function finish(data){if(!active||data.id!==active.id)return;const job=active;active=null;busy=false;if(data.blob){const url=URL.createObjectURL(data.blob);cache.set(job.key,url);if(cache.size>20){const key=cache.keys().next().value;URL.revokeObjectURL(cache.get(key));cache.delete(key)}job.resolve(url)}else job.resolve(null);advance()}
if(worker){worker.onmessage=e=>finish(e.data);worker.onerror=()=>{active?.resolve(null);active=null;busy=false;for(const j of queue)j.resolve(null);queue=[];worker.terminate();worker=null}}
function render(design,size=640,channel='main'){if(design.pattern==='image')return Promise.resolve(design.image||null);const d=design.pattern==='liquid'?{pattern:'solid',color:'#c3e3e0',accent:'#c3e3e0',opacity:8,amount:0,seed:1847}:design,key=JSON.stringify([d,size]);if(cache.has(key))return Promise.resolve(cache.get(key));return new Promise(resolve=>{if(!worker){setTimeout(()=>{try{const canvas=VinylMaterialCore.render(d,Math.min(size,220));if(canvas.convertToBlob)canvas.convertToBlob().then(b=>resolve(URL.createObjectURL(b))).catch(()=>resolve(null));else resolve(canvas.toDataURL('image/png'))}catch{resolve(null)}},0);return}if(channel==='main'){queue=queue.filter(j=>{if(j.channel==='main'){j.resolve(null);return false}return true})}queue.push({id:++nextId,key,design:d,size,channel,resolve});advance()})}
return {render};
})();

;

// 功能區段：custom.js
'use strict';
(()=>{
const el=id=>document.getElementById(id), volumeKey='vinyl-room.volume.v1';
let volume=100,muted=false,drag=null,draft=null,editingId=null;
try{const v=JSON.parse(localStorage.getItem(volumeKey));if(v&&Number.isFinite(v.level)){volume=Math.max(0,Math.min(100,v.level));muted=!!v.muted}}catch{}
function volumeUI(){el('volumeLevel').value=volume;el('volumeValue').textContent=(muted?0:volume)+'%';el('muteVolume').textContent=muted||!volume?'×':'♪';el('muteVolume').setAttribute('aria-pressed',String(muted||!volume));el('muteVolume').setAttribute('aria-label',muted||!volume?'取消靜音':'靜音')}
function applyVolume(){if(ready&&player){player.setVolume(muted||!volume?0:volume)}volumeUI()}
function saveVolume(){try{localStorage.setItem(volumeKey,JSON.stringify({level:volume,muted}))}catch{}applyVolume()}
el('volumeLevel').oninput=()=>{volume=Number(el('volumeLevel').value);muted=false;saveVolume()};el('muteVolume').onclick=()=>{if(!volume){volume=50;muted=false}else muted=!muted;saveVolume()};
const hex=x=>/^#[0-9a-f]{6}$/i.test(x||'');
const validImage=x=>typeof x==='string'&&x.length<=650000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x);
function safeDesign(d){return d&&hex(d.color)&&hex(d.accent)&&['solid','marble','splatter','split','liquid','image'].includes(d.pattern)?{color:d.color,accent:d.accent,pattern:d.pattern,opacity:Number.isFinite(d.opacity)?Math.max(0,Math.min(100,d.opacity)):65,amount:Number.isFinite(d.amount)?Math.max(0,Math.min(100,d.amount)):60,seed:Number.isSafeInteger(d.seed)?d.seed:1847,translucent:d.pattern==='liquid'?true:d.pattern==='image'?false:d.translucent!==false,imageZoom:Number.isFinite(d.imageZoom)?Math.max(1,Math.min(4,d.imageZoom)):1,imageX:Number.isFinite(d.imageX)?Math.max(0,Math.min(100,d.imageX)):50,imageY:Number.isFinite(d.imageY)?Math.max(0,Math.min(100,d.imageY)):50,imageRatio:Number.isFinite(d.imageRatio)?Math.max(.02,Math.min(50,d.imageRatio)):1,...(validImage(d.image)?{image:d.image}:{})}:null}
let paintRevision=0,paintTimer=0,imageRevision=0;
function applyEffects(d){const opaque=d&&(d.pattern==='image'||(d.pattern!=='liquid'&&d.translucent===false));el('deck').classList.toggle('opaque-deck',!!opaque);for(const target of [el('record'),el('vinylPreview')]){target.classList.toggle('opaque-vinyl',!!opaque);target.style.setProperty('--image-size',(100*Math.max(1,d?.imageRatio||1)*(d?.imageZoom||1))+'% auto');target.style.setProperty('--image-x',(d?.imageX??50)+'%');target.style.setProperty('--image-y',(d?.imageY??50)+'%');target.classList.toggle('liquid-vinyl',d?.pattern==='liquid');target.classList.toggle('picture-vinyl',d?.pattern==='image');target.style.setProperty('--liquid-color',d?.color||'#168d9a');target.style.setProperty('--liquid-accent',d?.accent||'#a0e4e6');target.style.setProperty('--liquid-amount',String(d?.amount??62));target.style.setProperty('--liquid-seed',String(d?.seed??1936));target.style.setProperty('--liquid-opacity-value',String(d?.opacity??70));target.style.setProperty('--liquid-fill',((100-(d?.amount??60))*.55+25)+'%');target.style.setProperty('--liquid-opacity',String(.4+(d?.opacity??65)*.006))}}
function controls(d){el('patternAmountHint').hidden=!['marble','splatter'].includes(d.pattern);el('diyDialog').classList.toggle('image-mode',d.pattern==='image');el('vinylTransmission').value=d.pattern==='liquid'?'clear':d.pattern==='image'||d.translucent===false?'opaque':'clear';el('vinylTransmission').disabled=['liquid','image'].includes(d.pattern);for(const [id,v] of [['vinylImageZoom',(d.imageZoom||1)*100],['vinylImageX',d.imageX??50],['vinylImageY',d.imageY??50]])el(id).value=v;el('vinylImageZoomValue').textContent=Math.round((d.imageZoom||1)*100)+'%';el('vinylOpacityValue').textContent=d.opacity+'%';el('vinylAmountValue').textContent=d.amount+'%';el('vinylAmount').disabled=['solid','split','image'].includes(d.pattern);el('vinylOpacity').disabled=d.pattern==='image'||d.translucent===false;el('imageVinylControls').hidden=d.pattern!=='image';el('vinylImageNote').textContent=d.image?'可拖曳左側預覽，或用滑桿調整大小和位置。':'選擇圖片後，可拖動左側預覽，或用滑桿調整大小和位置。';el('vinylAmountLabel').textContent=d.pattern==='liquid'?'液體填充量':'花紋濃度';el('vinylColor').disabled=el('vinylAccent').disabled=d.pattern==='image'}
async function paint(d,size=640){const rev=++paintRevision,record=el('record');record.classList.toggle('custom-vinyl',!!d);applyEffects(d);if(!d){record.style.removeProperty('--vinyl-art');return}controls(d);const art=await window.VinylMaterial.render(d,size);if(rev!==paintRevision)return;if(!art){if(d.pattern==='image'){record.style.setProperty('--vinyl-art','radial-gradient(circle,#d5d9cf,#eef0e8)');el('vinylPreview').style.backgroundImage='radial-gradient(circle,#d5d9cf,#eef0e8)'}else el('diyError').textContent='材質載入失敗，請重新整理後再試。';return}record.style.setProperty('--vinyl-art',`url("${art}")`);el('vinylPreview').style.backgroundImage=`url("${art}")`}
function selection(){if(typeof cancel==='function')cancel();clearTimeout(paintTimer);imageRevision++;if(el('diyDialog').open)el('diyDialog').close();paint(safeDesign(selected?.vinylDesign))}
function fillDesign(d){d=safeDesign(d);clearTimeout(paintTimer);imageRevision++;draft={...d};el('vinylColor').value=d.color;el('vinylAccent').value=d.accent;el('vinylPattern').value=d.pattern;el('vinylOpacity').value=d.opacity;el('vinylAmount').value=d.amount;paint(d);document.querySelectorAll('[data-vinyl-preset]').forEach(b=>b.setAttribute('aria-pressed','false'))}
const presets=[{name:'碧海煙紋',color:'#168d9a',accent:'#142e38',pattern:'marble',opacity:66,amount:63,seed:1847},{name:'冰藍飛濺',color:'#275d8c',accent:'#fff4dc',pattern:'splatter',opacity:12,amount:74,seed:2301},{name:'透明膠',color:'#d8e1df',accent:'#f3f7f5',pattern:'solid',opacity:5,amount:0,seed:7201,translucent:true},{name:'液態膠',color:'#208f9d',accent:'#b2eff0',pattern:'liquid',opacity:70,amount:62,seed:1936},{name:'圖片唱片',color:'#557d73',accent:'#e9dbc5',pattern:'image',opacity:100,amount:50,seed:1936}];
let thumbnailsReady=false;
el('openDIY').onclick=()=>{editingId=selected.id;fillDesign(safeDesign(selected.vinylDesign)||presets[0]);el('diyError').textContent='';document.body.classList.add('diy-open');el('diyDialog').showModal();if(!thumbnailsReady){thumbnailsReady=true;presets.forEach((p,i)=>{const b=document.querySelector(`[data-vinyl-preset="${i}"]`);if(p.pattern==='image')b.querySelector('i').classList.add('picture-thumb');else window.VinylMaterial.render(p,140,'thumb-'+i).then(url=>{if(url)b.querySelector('i').style.backgroundImage=`url("${url}")`});b.onclick=()=>{fillDesign(p.pattern==='image'&&draft?.image?{...p,image:draft.image,imageRatio:draft.imageRatio,imageZoom:draft.imageZoom,imageX:draft.imageX,imageY:draft.imageY}:p);b.setAttribute('aria-pressed','true')}})}};
function readInputs(){draft={...draft,color:el('vinylColor').value,accent:el('vinylAccent').value,pattern:el('vinylPattern').value,opacity:Number(el('vinylOpacity').value),amount:Number(el('vinylAmount').value),translucent:el('vinylTransmission').value==='clear',imageZoom:Number(el('vinylImageZoom').value)/100,imageX:Number(el('vinylImageX').value),imageY:Number(el('vinylImageY').value)};controls(draft);applyEffects(draft)}
for(const id of ['vinylColor','vinylAccent','vinylPattern','vinylOpacity','vinylAmount','vinylTransmission']){el(id).oninput=()=>{readInputs();++paintRevision;clearTimeout(paintTimer);paintTimer=setTimeout(()=>paint({...draft},240),45)};el(id).onchange=()=>{readInputs();clearTimeout(paintTimer);paint(draft,640)}}
for(const id of ['vinylImageZoom','vinylImageX','vinylImageY'])el(id).oninput=()=>{readInputs()};
el('resetVinylImage').onclick=()=>{draft={...draft,imageZoom:1,imageX:50,imageY:50};controls(draft);applyEffects(draft)};
let imageDrag=null;
el('vinylPreview').addEventListener('pointerdown',e=>{if(draft?.pattern!=='image'||!draft.image||e.button!==0)return;e.preventDefault();const r=el('vinylPreview').getBoundingClientRect();imageDrag={id:e.pointerId,x:e.clientX,y:e.clientY,px:draft.imageX??50,py:draft.imageY??50,size:r.width};el('vinylPreview').setPointerCapture(e.pointerId)});
el('vinylPreview').addEventListener('pointermove',e=>{if(imageDrag?.id!==e.pointerId)return;const d=imageDrag,w=d.size*Math.max(1,draft.imageRatio||1)*(draft.imageZoom||1),h=w/(draft.imageRatio||1);draft={...draft,imageX:w>d.size+.1?Math.max(0,Math.min(100,d.px-(e.clientX-d.x)/(w-d.size)*100)):50,imageY:h>d.size+.1?Math.max(0,Math.min(100,d.py-(e.clientY-d.y)/(h-d.size)*100)):50};controls(draft);applyEffects(draft)});
for(const type of ['pointerup','pointercancel','lostpointercapture'])el('vinylPreview').addEventListener(type,()=>imageDrag=null);
function colorHex(h,s,l){s/=100;l/=100;const a=s*Math.min(l,1-l),channel=n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0')};return '#'+channel(0)+channel(8)+channel(4)}
let lastRandomHue=null;
el('randomVinylColors').onclick=()=>{if(!draft||draft.pattern==='image')return;let h;do{h=Math.random()*360}while(lastRandomHue!==null&&Math.min(Math.abs(h-lastRandomHue),360-Math.abs(h-lastRandomHue))<55);lastRandomHue=h;const scheme=Math.floor(Math.random()*6),s=28+Math.random()*66,l=16+Math.random()*68,offset=[22,75,145,180,220,290][scheme]+Math.random()*25-12;const color=colorHex(h,s,l),accent=colorHex((h+offset+360)%360,25+Math.random()*70,l>55?12+Math.random()*32:60+Math.random()*32);fillDesign({...draft,color,accent,seed:Math.floor(Math.random()*1e8)});el('randomColorStatus').textContent='已產生新配色與紋理；儲存設計後保留。'};
el('remixVinyl').onclick=()=>{draft={...draft,seed:Math.floor(Math.random()*1e8)};paint(draft)};
el('uploadVinylImage').onclick=()=>el('vinylImageFile').click();
el('vinylImageFile').onchange=async()=>{const file=el('vinylImageFile').files[0],own=++imageRevision;el('vinylImageFile').value='';if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024){el('diyError').textContent='請選擇 15 MB 以內的 JPG、PNG 或 WebP 圖片。';return}let url;el('diyError').textContent='';try{url=URL.createObjectURL(file);const img=new Image();img.src=url;await img.decode();if(own!==imageRevision||!el('diyDialog').open)return;const canvas=document.createElement('canvas'),scale=Math.min(1,960/Math.max(img.naturalWidth,img.naturalHeight));canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#f4f1e9';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);let image=canvas.toDataURL('image/jpeg',.82);if(image.length>650000)image=canvas.toDataURL('image/jpeg',.6);if(!validImage(image))throw new Error('圖片過大，請換一張較簡單的圖片。');draft={...draft,pattern:'image',image,translucent:false,imageRatio:img.naturalWidth/img.naturalHeight,imageZoom:1,imageX:50,imageY:50};el('vinylPattern').value='image';paint(draft)}catch(e){el('diyError').textContent=e.message||'無法讀取圖片，請換一張圖片。'}finally{if(url)URL.revokeObjectURL(url)}};
el('closeDIY').onclick=()=>el('diyDialog').close();el('diyDialog').addEventListener('close',()=>{clearTimeout(paintTimer);imageRevision++;document.body.classList.remove('diy-open');paint(safeDesign(selected.vinylDesign))});
function commitDesign(d){if(selected.id!==editingId)return;if(d?.pattern==='image'&&!d.image){el('diyError').textContent='請先選擇要鋪在唱片上的圖片。';return}const old=selected.vinylDesign;selected.vinylDesign=d;if(!selected.demo&&!persist()){selected.vinylDesign=old;el('diyError').textContent='儲存失敗，請先匯出收藏備份。';return}el('diyDialog').close();paint(d);notify(selected.demo?'已套用預覽；收藏歌曲後可永久儲存設計。':'唱片設計已儲存')}
el('saveDIY').onclick=()=>commitDesign(safeDesign(draft));el('resetDIY').onclick=()=>commitDesign(safeDesign(defaultVinylDesign()));
const arm=el('tonearm'),svg=arm.ownerSVGElement;arm.setAttribute('role','slider');arm.setAttribute('tabindex','0');arm.setAttribute('aria-label','唱針；左右鍵調整進度，空白鍵播放或暫停');arm.setAttribute('aria-valuemin','0');arm.setAttribute('aria-valuemax','100');arm.setAttribute('aria-valuenow','0');
function ratioNow(){return demoOn?demoRatio:ready&&player.getDuration()?player.getCurrentTime()/player.getDuration():0}
function preview(angle){arm.setAttribute('transform',`rotate(${angle} 438 62)`);const r=Math.max(0,Math.min(1,(angle-20)/21));arm.setAttribute('aria-valuenow',Math.round(r*100));el('needleNote').textContent=angle<12?'放回唱針架以暫停':'放下唱針以播放 · '+Math.round(r*100)+'%';return r}
let armCommand=0,armQueue=Promise.resolve();
function drop(angle,r){
 const revision=++armCommand,own=session;
 window.vinylArmDragging=false;arm.classList.remove('arm-lifted');
 const parked=angle<12;window.vinylArmParked=parked;
 const valid=()=>revision===armCommand&&own===session;
 armQueue=armQueue.catch(()=>{}).then(async()=>{
  if(!valid())return;
  if(selected.demo){if(parked){if(demoOn)toggleDemo();setNeedle(0,false)}else{if(!demoOn)toggleDemo();demoRatio=r;el('demoSeek').value=r*1000;setNeedle(r,true)}return}
  try{
   const p=await ensurePlayer();if(!valid())return;
   if(parked){await p.pauseVideo();if(valid())setNeedle(0,false);return}
   const d=p.getDuration();
   if(!d){notify('請先播放歌曲，再拖曳唱針調整進度。');setNeedle(0,false);return}
   demoOn=false;await p.seekTo(r*Math.max(0,d-.1),true);
   if(!valid())return;
   await p.playVideo();if(valid())setNeedle(r,true);
  }catch(e){if(valid()){notify(e.message);setNeedle(0,false)}}
 });return armQueue;
}
arm.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();armCommand++;arm.classList.add('arm-lifted');drag={id:e.pointerId,session,angle:needleDown?20+21*ratioNow():-8,r:ratioNow()};window.vinylArmDragging=true;arm.setPointerCapture(e.pointerId)});
arm.addEventListener('pointermove',e=>{if(drag?.id!==e.pointerId)return;const point=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());drag.angle=Math.max(-8,Math.min(41,Math.atan2(438-point.x,point.y-62)*180/Math.PI));drag.r=preview(drag.angle)});
arm.addEventListener('pointerup',e=>{if(drag?.id!==e.pointerId)return;const d=drag;drag=null;if(arm.hasPointerCapture(e.pointerId))arm.releasePointerCapture(e.pointerId);if(d.session!==session){window.vinylArmDragging=false;arm.classList.remove('arm-lifted');return}drop(d.angle,d.r)});
function cancel(){if(!drag)return;drag=null;armCommand++;arm.classList.remove('arm-lifted');window.vinylArmDragging=false;setNeedle(ratioNow(),needleDown)}arm.addEventListener('pointercancel',cancel);arm.addEventListener('lostpointercapture',cancel);window.addEventListener('blur',cancel);
arm.addEventListener('keydown',e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();if(selected.demo)toggleDemo();else el('play').click()}else if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();if(e.key==='Home')drop(-8,0);else{const r=e.key==='End'?.999:Math.max(0,Math.min(.999,ratioNow()+(e.key==='ArrowRight'?.02:-.02)));drop(20+21*r,r)}}});
window.VinylCustom={applyVolume,selection,safeDesign};volumeUI();selection();
})();

;

// 功能區段：liquid-field.js
'use strict';
// A transported two-phase film. One continuous scalar field allows liquid necks,
// holes and connected pools to stretch, join and separate instead of moving sprites.
globalThis.VinylLiquidField=class{
constructor(size=144){this.n=size;this.a=new Float32Array(size*size);this.b=new Float32Array(size*size);this.mask=new Uint8Array(size*size);this.cells=[];this.time=0;this.target=.6;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const u=(x+.5)/size*2-1,v=(y+.5)/size*2-1,r=Math.hypot(u,v),i=y*size+x;if(r<.965&&r>.315){this.mask[i]=1;this.cells.push({i,x,y,u,v,r,angle:Math.atan2(v,u),band:Math.sin((r-.315)/.65*Math.PI)})}}this.canvas=(typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(size,size):document.createElement('canvas'));this.canvas.width=this.canvas.height=1024;this.ctx=this.canvas.getContext('2d');this.reset(.62,1936)}
reset(amount,seed){this.amount=amount;this.seed=seed;this.time=0;const holes=[[-.62,-.25,.28,.35],[.45,-.45,.42,.25],[.15,.63,.36,.26],[-.49,.48,.19,.21],[.69,.13,.15,.29]];let sum=0;for(const p of this.cells){const angle=Math.atan2(p.v,p.u);let clear=0;for(let k=0;k<holes.length;k++){const [hx,hy,w,h]=holes[k],rotation=seed*.017, x=hx*Math.cos(rotation)-hy*Math.sin(rotation),y=hx*Math.sin(rotation)+hy*Math.cos(rotation),jitter=Math.sin(angle*4+k+seed*.01)*.11;const d=Math.hypot((p.u-x)/(w+jitter*.2),(p.v-y)/(h+jitter*.2));clear=Math.max(clear,1-this.smooth(.8,1.15,d))}for(let k=0;k<17;k++){const an=k*2.399+seed*.01,rad=.42+(k%5)*.09,cx=Math.cos(an)*rad,cy=Math.sin(an)*rad,rr=.018+(k%4)*.012;clear=Math.max(clear,1-this.smooth(rr*.6,rr*1.2,Math.hypot(p.u-cx,p.v-cy)))}const value=Math.max(0,Math.min(1,1-clear));this.a[p.i]=value;sum+=value}this.target=Math.max(.22,Math.min(.88,.28+amount*.55));this.correct(this.a,this.target-sum/this.cells.length)}
smooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)}
sample(a,x,y,fallback){const n=this.n;x=Math.max(0,Math.min(n-1.001,x));y=Math.max(0,Math.min(n-1.001,y));const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=iy*n+ix,m=this.mask;const p=m[i]?a[i]:fallback,q=m[i+1]?a[i+1]:fallback,r=m[i+n]?a[i+n]:fallback,s=m[i+n+1]?a[i+n+1]:fallback;return (p*(1-fx)+q*fx)*(1-fy)+(r*(1-fx)+s*fx)*fy}
correct(a,error){for(const p of this.cells){const f=a[p.i];a[p.i]=Math.max(0,Math.min(1,f+error*(.2+3.8*f*(1-f))))}}
step(dt,energy){this.time+=dt*energy;const t=this.time,n=this.n,a=this.a,b=this.b,step=Math.min(.04,dt)*energy;let sum=0;for(const p of this.cells){const an=p.angle,band=p.band,shear=.13*Math.sin(an*2+t*.4)*band;let vx=-p.v*shear,vy=p.u*shear;for(let k=0;k<3;k++){const theta=k*2.094+t*(k%2?-.13:.11),cx=Math.cos(theta)*.62,cy=Math.sin(theta)*.62,dx=p.u-cx,dy=p.v-cy,weight=(k%2?-.017:.023)/(dx*dx+dy*dy+.09);vx-=dy*weight;vy+=dx*weight}const radial=(vx*p.u+vy*p.v)/(p.r*p.r);const boundary=1-band;vx-=radial*p.u*boundary;vy-=radial*p.v*boundary;let f=this.sample(a,p.x-vx*step*n/2,p.y-vy*step*n/2,a[p.i]);const near=j=>this.mask[j]?a[j]:a[p.i];const lap=(near(p.i-1)+near(p.i+1)+near(p.i-n)+near(p.i+n))*.25-f;f+=lap*.11*energy+f*(1-f)*(f-.5)*.27*energy;b[p.i]=Math.max(0,Math.min(1,f));sum+=b[p.i]}this.correct(b,(this.target-sum/this.cells.length)*.17);this.a=b;this.b=a}
contours(){const n=this.n,values=new Float32Array((n+2)*(n+2)),stride=n+2;for(let y=0;y<stride;y++)for(let x=0;x<stride;x++){if(x===0||y===0||x===stride-1||y===stride-1){values[y*stride+x]=0;continue}let u=(x-1+.5)/n*2-1,v=(y-1+.5)/n*2-1,r=Math.hypot(u,v);if(r>.93||r<.35){const rr=r>.93?.93:.35;u*=rr/(r||1);v*=rr/(r||1)}values[y*stride+x]=this.sample(this.a,(u+1)*n/2-.5,(v+1)*n/2-.5,0)}const nodes=new Map(),segments=[],connect=(a,b)=>{segments.push([a,b]);for(const [p,q] of [[a,b],[b,a]]){if(!nodes.has(p.key))nodes.set(p.key,{p,links:[]});nodes.get(p.key).links.push(q.key)}};
for(let y=0;y<stride-1;y++)for(let x=0;x<stride-1;x++){const i=y*stride+x,v=[values[i],values[i+1],values[i+stride+1],values[i+stride]],points=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],cross=[];for(let e=0;e<4;e++){const j=(e+1)%4;if((v[e]>=.5)===(v[j]>=.5))continue;const t=(.5-v[e])/(v[j]-v[e]),p=points[e],q=points[j],key=e===0?'h'+x+','+y:e===1?'v'+(x+1)+','+y:e===2?'h'+x+','+(y+1):'v'+x+','+y;cross.push({x:(p[0]+(q[0]-p[0])*t-1+.5)/n,y:(p[1]+(q[1]-p[1])*t-1+.5)/n,key})}if(cross.length===2)connect(cross[0],cross[1]);else if(cross.length===4){if((v.reduce((a,b)=>a+b,0)/4>=.5)===(v[0]>=.5)){connect(cross[0],cross[1]);connect(cross[2],cross[3])}else{connect(cross[0],cross[3]);connect(cross[1],cross[2])}}}
const used=new Set(),loops=[];for(const node of nodes.values()){if(used.has(node.p.key))continue;let key=node.p.key,prev=null;const line=[];while(key&&!used.has(key)){const entry=nodes.get(key);if(!entry)break;used.add(key);line.push(entry.p);const next=entry.links.find(k=>k!==prev&&!used.has(k))||entry.links.find(k=>k!==prev);prev=key;key=next}if(line.length>3)loops.push(line)}return loops}
draw(color,accent,opacity){const ctx=this.ctx,w=this.canvas.width;ctx.clearRect(0,0,w,w);ctx.save();ctx.beginPath();ctx.arc(w/2,w/2,w*.473,0,Math.PI*2);ctx.arc(w/2,w/2,w*.164,0,Math.PI*2,true);ctx.clip('evenodd');ctx.globalAlpha=.10;ctx.fillStyle=accent;ctx.fillRect(0,0,w,w);ctx.globalAlpha=.76+opacity*.0021;
const loops=this.contours();ctx.beginPath();for(const points of loops){const last=points[points.length-1],first=points[0];ctx.moveTo((last.x+first.x)*w/2,(last.y+first.y)*w/2);for(let j=0;j<points.length;j++){const p=points[j],q=points[(j+1)%points.length];ctx.quadraticCurveTo(p.x*w,p.y*w,(p.x+q.x)*w/2,(p.y+q.y)*w/2)}ctx.closePath()}
ctx.fillStyle=color;ctx.fill('evenodd');ctx.globalAlpha=.30;ctx.lineWidth=w*.0011;ctx.strokeStyle=accent;ctx.stroke();ctx.globalAlpha=1;
for(let j=0;j<34;j++){const theta=j*2.399+this.seed*.013+this.time*(.035+(j%3)*.008),rad=.38+(j%7)*.076,u=Math.cos(theta)*rad,v=Math.sin(theta)*rad;if(this.sample(this.a,(u+1)*this.n/2-.5,(v+1)*this.n/2-.5,0)<.8)continue;const x=(u+1)*w/2,y=(v+1)*w/2,r=(.0028+(j%4)*.0018)*w;ctx.save();ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,.68)';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();ctx.strokeStyle='rgba(237,255,255,.55)';ctx.lineWidth=.8;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke()}ctx.restore();return this.canvas}
};

;

// 功能區段：liquid-motion.js
'use strict';
(()=>{
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,states=[];let worker=null,fallbackFrame=null,last=0;
for(const owner of [document.getElementById('record'),document.getElementById('vinylPreview')]){const cavity=owner.querySelector('.liquid-cavity'),canvas=document.createElement('canvas');canvas.width=canvas.height=1024;canvas.className='liquid-film';canvas.setAttribute('aria-hidden','true');cavity.append(canvas);states.push({id:owner.id,owner,cavity,canvas,visible:false,energy:0,amount:null,seed:null})}
if(typeof Worker!=='undefined'&&states[0].canvas.transferControlToOffscreen){try{worker=new Worker(URL.createObjectURL(new Blob(["'use strict';\n// A transported two-phase film. One continuous scalar field allows liquid necks,\n// holes and connected pools to stretch, join and separate instead of moving sprites.\nglobalThis.VinylLiquidField=class{\nconstructor(size=144){this.n=size;this.a=new Float32Array(size*size);this.b=new Float32Array(size*size);this.mask=new Uint8Array(size*size);this.cells=[];this.time=0;this.target=.6;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const u=(x+.5)/size*2-1,v=(y+.5)/size*2-1,r=Math.hypot(u,v),i=y*size+x;if(r<.965&&r>.315){this.mask[i]=1;this.cells.push({i,x,y,u,v,r,angle:Math.atan2(v,u),band:Math.sin((r-.315)/.65*Math.PI)})}}this.canvas=(typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(size,size):document.createElement('canvas'));this.canvas.width=this.canvas.height=1024;this.ctx=this.canvas.getContext('2d');this.reset(.62,1936)}\nreset(amount,seed){this.amount=amount;this.seed=seed;this.time=0;const holes=[[-.62,-.25,.28,.35],[.45,-.45,.42,.25],[.15,.63,.36,.26],[-.49,.48,.19,.21],[.69,.13,.15,.29]];let sum=0;for(const p of this.cells){const angle=Math.atan2(p.v,p.u);let clear=0;for(let k=0;k<holes.length;k++){const [hx,hy,w,h]=holes[k],rotation=seed*.017, x=hx*Math.cos(rotation)-hy*Math.sin(rotation),y=hx*Math.sin(rotation)+hy*Math.cos(rotation),jitter=Math.sin(angle*4+k+seed*.01)*.11;const d=Math.hypot((p.u-x)/(w+jitter*.2),(p.v-y)/(h+jitter*.2));clear=Math.max(clear,1-this.smooth(.8,1.15,d))}for(let k=0;k<17;k++){const an=k*2.399+seed*.01,rad=.42+(k%5)*.09,cx=Math.cos(an)*rad,cy=Math.sin(an)*rad,rr=.018+(k%4)*.012;clear=Math.max(clear,1-this.smooth(rr*.6,rr*1.2,Math.hypot(p.u-cx,p.v-cy)))}const value=Math.max(0,Math.min(1,1-clear));this.a[p.i]=value;sum+=value}this.target=Math.max(.22,Math.min(.88,.28+amount*.55));this.correct(this.a,this.target-sum/this.cells.length)}\nsmooth(a,b,x){const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)}\nsample(a,x,y,fallback){const n=this.n;x=Math.max(0,Math.min(n-1.001,x));y=Math.max(0,Math.min(n-1.001,y));const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=iy*n+ix,m=this.mask;const p=m[i]?a[i]:fallback,q=m[i+1]?a[i+1]:fallback,r=m[i+n]?a[i+n]:fallback,s=m[i+n+1]?a[i+n+1]:fallback;return (p*(1-fx)+q*fx)*(1-fy)+(r*(1-fx)+s*fx)*fy}\ncorrect(a,error){for(const p of this.cells){const f=a[p.i];a[p.i]=Math.max(0,Math.min(1,f+error*(.2+3.8*f*(1-f))))}}\nstep(dt,energy){this.time+=dt*energy;const t=this.time,n=this.n,a=this.a,b=this.b,step=Math.min(.04,dt)*energy;let sum=0;for(const p of this.cells){const an=p.angle,band=p.band,shear=.13*Math.sin(an*2+t*.4)*band;let vx=-p.v*shear,vy=p.u*shear;for(let k=0;k<3;k++){const theta=k*2.094+t*(k%2?-.13:.11),cx=Math.cos(theta)*.62,cy=Math.sin(theta)*.62,dx=p.u-cx,dy=p.v-cy,weight=(k%2?-.017:.023)/(dx*dx+dy*dy+.09);vx-=dy*weight;vy+=dx*weight}const radial=(vx*p.u+vy*p.v)/(p.r*p.r);const boundary=1-band;vx-=radial*p.u*boundary;vy-=radial*p.v*boundary;let f=this.sample(a,p.x-vx*step*n/2,p.y-vy*step*n/2,a[p.i]);const near=j=>this.mask[j]?a[j]:a[p.i];const lap=(near(p.i-1)+near(p.i+1)+near(p.i-n)+near(p.i+n))*.25-f;f+=lap*.11*energy+f*(1-f)*(f-.5)*.27*energy;b[p.i]=Math.max(0,Math.min(1,f));sum+=b[p.i]}this.correct(b,(this.target-sum/this.cells.length)*.17);this.a=b;this.b=a}\ncontours(){const n=this.n,values=new Float32Array((n+2)*(n+2)),stride=n+2;for(let y=0;y<stride;y++)for(let x=0;x<stride;x++){if(x===0||y===0||x===stride-1||y===stride-1){values[y*stride+x]=0;continue}let u=(x-1+.5)/n*2-1,v=(y-1+.5)/n*2-1,r=Math.hypot(u,v);if(r>.93||r<.35){const rr=r>.93?.93:.35;u*=rr/(r||1);v*=rr/(r||1)}values[y*stride+x]=this.sample(this.a,(u+1)*n/2-.5,(v+1)*n/2-.5,0)}const nodes=new Map(),segments=[],connect=(a,b)=>{segments.push([a,b]);for(const [p,q] of [[a,b],[b,a]]){if(!nodes.has(p.key))nodes.set(p.key,{p,links:[]});nodes.get(p.key).links.push(q.key)}};\nfor(let y=0;y<stride-1;y++)for(let x=0;x<stride-1;x++){const i=y*stride+x,v=[values[i],values[i+1],values[i+stride+1],values[i+stride]],points=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],cross=[];for(let e=0;e<4;e++){const j=(e+1)%4;if((v[e]>=.5)===(v[j]>=.5))continue;const t=(.5-v[e])/(v[j]-v[e]),p=points[e],q=points[j],key=e===0?'h'+x+','+y:e===1?'v'+(x+1)+','+y:e===2?'h'+x+','+(y+1):'v'+x+','+y;cross.push({x:(p[0]+(q[0]-p[0])*t-1+.5)/n,y:(p[1]+(q[1]-p[1])*t-1+.5)/n,key})}if(cross.length===2)connect(cross[0],cross[1]);else if(cross.length===4){if((v.reduce((a,b)=>a+b,0)/4>=.5)===(v[0]>=.5)){connect(cross[0],cross[1]);connect(cross[2],cross[3])}else{connect(cross[0],cross[3]);connect(cross[1],cross[2])}}}\nconst used=new Set(),loops=[];for(const node of nodes.values()){if(used.has(node.p.key))continue;let key=node.p.key,prev=null;const line=[];while(key&&!used.has(key)){const entry=nodes.get(key);if(!entry)break;used.add(key);line.push(entry.p);const next=entry.links.find(k=>k!==prev&&!used.has(k))||entry.links.find(k=>k!==prev);prev=key;key=next}if(line.length>3)loops.push(line)}return loops}\ndraw(color,accent,opacity){const ctx=this.ctx,w=this.canvas.width;ctx.clearRect(0,0,w,w);ctx.save();ctx.beginPath();ctx.arc(w/2,w/2,w*.473,0,Math.PI*2);ctx.arc(w/2,w/2,w*.164,0,Math.PI*2,true);ctx.clip('evenodd');ctx.globalAlpha=.10;ctx.fillStyle=accent;ctx.fillRect(0,0,w,w);ctx.globalAlpha=.76+opacity*.0021;\nconst loops=this.contours();ctx.beginPath();for(const points of loops){const last=points[points.length-1],first=points[0];ctx.moveTo((last.x+first.x)*w/2,(last.y+first.y)*w/2);for(let j=0;j<points.length;j++){const p=points[j],q=points[(j+1)%points.length];ctx.quadraticCurveTo(p.x*w,p.y*w,(p.x+q.x)*w/2,(p.y+q.y)*w/2)}ctx.closePath()}\nctx.fillStyle=color;ctx.fill('evenodd');ctx.globalAlpha=.30;ctx.lineWidth=w*.0011;ctx.strokeStyle=accent;ctx.stroke();ctx.globalAlpha=1;\nfor(let j=0;j<34;j++){const theta=j*2.399+this.seed*.013+this.time*(.035+(j%3)*.008),rad=.38+(j%7)*.076,u=Math.cos(theta)*rad,v=Math.sin(theta)*rad;if(this.sample(this.a,(u+1)*this.n/2-.5,(v+1)*this.n/2-.5,0)<.8)continue;const x=(u+1)*w/2,y=(v+1)*w/2,r=(.0028+(j%4)*.0018)*w;ctx.save();ctx.globalCompositeOperation='destination-out';ctx.fillStyle='rgba(0,0,0,.68)';ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.restore();ctx.strokeStyle='rgba(237,255,255,.55)';ctx.lineWidth=.8;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.stroke()}ctx.restore();return this.canvas}\n};\n\n;\n'use strict';\n\nconst states=new Map();let timer=null,last=0;\nfunction start(){if(timer===null){last=performance.now();timer=setTimeout(tick,0)}}\nfunction tick(){timer=null;const now=performance.now(),dt=Math.min(.04,(now-last)/1000);last=now;let again=false;for(const s of states.values()){const d=s.data;if(!d?.visible)continue;if(d.amount!==s.amount||d.seed!==s.seed){s.field.reset(d.amount/100,d.seed);s.amount=d.amount;s.seed=d.seed}s.energy+=((d.playing?1:0)-s.energy)*Math.min(1,dt*(d.playing?1.4:1.8));if(s.energy>.003)s.field.step(dt,s.energy);s.ctx.clearRect(0,0,s.canvas.width,s.canvas.height);s.ctx.drawImage(s.field.draw(d.color,d.accent,d.opacity),0,0,s.canvas.width,s.canvas.height);const motion=s.energy>.02?'flowing':'settled';if(s.motion!==motion){s.motion=motion;postMessage({id:s.id,motion})}if(d.playing||s.energy>.003)again=true}if(again)timer=setTimeout(tick,33)}\nonmessage=({data})=>{if(data.init){for(const item of data.init){states.set(item.id,{id:item.id,canvas:item.canvas,ctx:item.canvas.getContext('2d'),field:new VinylLiquidField(128),energy:0})}}else for(const d of data.states||[]){const s=states.get(d.id);if(s)s.data=d}start()};\n"],{type:"text/javascript"})));const init=states.map(s=>({id:s.id,canvas:s.canvas.transferControlToOffscreen()}));worker.postMessage({init},init.map(s=>s.canvas));worker.onmessage=({data})=>{const s=states.find(s=>s.id===data.id);if(s)s.cavity.dataset.liquidMotion=data.motion}}catch{worker=null}}
function data(){const dialogOpen=document.getElementById('diyDialog').open;return states.map(s=>({id:s.id,visible:!document.hidden&&s.visible&&s.owner.classList.contains('liquid-vinyl')&&(s.id==='vinylPreview'?dialogOpen:!dialogOpen),playing:!reduced&&(s.id==='vinylPreview'?dialogOpen:document.body.classList.contains('music-playing')),color:s.owner.style.getPropertyValue('--liquid-color')||'#208f9d',accent:s.owner.style.getPropertyValue('--liquid-accent')||'#b2eff0',opacity:Number(s.owner.style.getPropertyValue('--liquid-opacity-value')||70),amount:Number(s.owner.style.getPropertyValue('--liquid-amount')||62),seed:Number(s.owner.style.getPropertyValue('--liquid-seed'))||1936}))}
function update(){const values=data();if(worker)worker.postMessage({states:values});else{states.forEach((s,i)=>{s.data=values[i];if(!s.field){s.field=new VinylLiquidField(80);s.ctx=s.canvas.getContext('2d')}});if(fallbackFrame===null){last=performance.now();fallbackFrame=setTimeout(fallbackTick,0)}}}
function fallbackTick(){fallbackFrame=null;const now=performance.now(),dt=Math.min(.04,(now-last)/1000);last=now;let again=false;for(const s of states){const d=s.data;if(!d.visible)continue;if(d.amount!==s.amount||d.seed!==s.seed){s.field.reset(d.amount/100,d.seed);s.amount=d.amount;s.seed=d.seed}s.energy+=((d.playing?1:0)-s.energy)*Math.min(1,dt*1.5);if(s.energy>.003)s.field.step(dt,s.energy);s.ctx.clearRect(0,0,s.canvas.width,s.canvas.height);s.ctx.drawImage(s.field.draw(d.color,d.accent,d.opacity),0,0,1024,1024);s.cavity.dataset.liquidMotion=s.energy>.02?'flowing':'settled';if(d.playing||s.energy>.003)again=true}if(again)fallbackFrame=setTimeout(fallbackTick,40)}
new IntersectionObserver(entries=>{for(const e of entries){states.find(s=>s.owner===e.target).visible=e.isIntersecting}update()}).observe(states[0].owner);
const previewObserver=new IntersectionObserver(entries=>{states[1].visible=entries[0].isIntersecting;update()});previewObserver.observe(states[1].owner);
new MutationObserver(update).observe(document.body,{attributes:true,attributeFilter:['class']});states.forEach(s=>new MutationObserver(update).observe(s.owner,{attributes:true,attributeFilter:['class','style']}));new MutationObserver(update).observe(document.getElementById('diyDialog'),{attributes:true,attributeFilter:['open']});document.addEventListener('visibilitychange',update);update();
})();

;

// 功能區段：lighting-ui.js
'use strict';
(() => {
  const input=document.getElementById('customLightColor');
  const key='vinyl-room.spotify.custom-light';
  function apply(color){
    if(!/^#[0-9a-f]{6}$/i.test(color))return;
    const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
    for(const hex of glowCodes){const alpha=hex.length===8?parseInt(hex.slice(6),16)/255:1;$('deck').style.setProperty('--glow-'+hex,`rgb(${rgb.join(' ')} / ${alpha})`)}
    document.querySelectorAll('[data-light]').forEach(b=>b.setAttribute('aria-pressed','false'));
    setLamp(true);
  }
  input.oninput=()=>apply(input.value);
  input.onchange=()=>{apply(input.value);try{localStorage.setItem(key,input.value);localStorage.setItem('vinyl-room.spotify.light','custom')}catch{}};
  $('togglePanelLamp').onclick=()=>$('lampSwitch').click();
  try{const color=localStorage.getItem(key);if(localStorage.getItem('vinyl-room.spotify.light')==='custom'&&/^#[0-9a-f]{6}$/i.test(color)){input.value=color;const wasOn=lampOn;apply(color);setLamp(wasOn)}}catch{}
  document.addEventListener('click',e=>{const picker=document.querySelector('.light-picker');if(!picker.contains(e.target))picker.open=false});
})();

;

// 功能區段：record-interaction.js
/* Manual selection places the record before starting playback; automatic queue changes stay independent. */
(()=>{
 const key='vinyl-room.interaction-motion.v1',deck=document.getElementById('deck');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let enabled=true,animation=null,lastId=selected.id;
 try{enabled=localStorage.getItem(key)!=='off'}catch{}
 const button=document.createElement('button');button.type='button';button.className='outline interaction-toggle';
 const utility=document.createElement('div');utility.className='player-utility-row';
 const info=document.createElement('div');info.className='needle-info-card';info.setAttribute('role','group');info.setAttribute('aria-label','唱針位置與操作說明');
 playerReconnect.before(utility);
 info.append(document.querySelector('.needle-readout'),document.querySelector('.arm-hint'));
 utility.append(playerReconnect,button,info);
 function refresh(){button.textContent=enabled?'放片動畫：開啟':'放片動畫：關閉';button.setAttribute('aria-pressed',String(enabled));button.title=reduced.matches?'依系統偏好減少動態效果':'切換專輯時顯示放片動畫';document.body.classList.toggle('record-motion-off',!enabled||reduced.matches);if(!enabled||reduced.matches)animation?.cancel()}
 button.onclick=()=>{enabled=!enabled;try{localStorage.setItem(key,enabled?'on':'off')}catch{}refresh()};reduced.addEventListener('change',refresh);refresh();
 function place(){return document.getElementById('record').animate([
  {translate:'-12px -75px',scale:'1.14',opacity:0,filter:'drop-shadow(0 25px 12px #172a3950)'},
  {translate:'0 -24px',scale:'1.07',opacity:1,offset:.5,filter:'drop-shadow(0 14px 8px #172a3940)'},
  {translate:'0 2px',scale:'.995',opacity:1,offset:.85,filter:'none'},
  {translate:'0 0',scale:'1',opacity:1,filter:'none'}
 ],{duration:850,easing:'cubic-bezier(.2,.65,.25,1)'});}
 let placing=0;
 window.VinylPlacement={async play(t){
  const request=++placing,own=session;
  const valid=()=>request===placing&&session===own&&selected.id===t.id&&!document.getElementById('playerView').hidden;
  animation?.cancel();
  if(enabled&&!reduced.matches){animation=place();await animation.finished.catch(()=>{});}
  if(!valid())return;
  window.vinylArmParked=false;
  if(enabled&&!reduced.matches){
   const arm=document.getElementById('tonearm');
   const from=-8,to=20+21*(resumePoint?.position/(resumePoint?.duration||1)||0);
   await new Promise(resolve=>{const begin=performance.now();function tick(now){if(!valid()){resolve();return}const p=Math.min(1,(now-begin)/350);arm.setAttribute('transform',`rotate(${from+(to-from)*(1-(1-p)**3)} 438 62)`);if(p<1)requestAnimationFrame(tick);else resolve()}requestAnimationFrame(tick)});
  }
  if(!valid())return;
  try{await playTrack(activeIndex,singleFallbackUsed)}catch(e){if(valid()){setNeedle(0,false);error(e)}}
 }};
 const original=window.VinylRoomUI.select;
 window.VinylRoomUI.select=function(t){original.call(this,t);if(t.id===lastId)return;lastId=t.id;animation?.cancel();if(t.demo||window.vinylManualPlacement||!enabled||reduced.matches)return;
  animation=place();
 };
})();

;

// 功能區段：sleeve-extraction.js
/* Read the stored per-album design. This transition never sends playback commands. */
(()=>{
 let busy=false;
 const allowed=()=>!matchMedia('(prefers-reduced-motion: reduce)').matches&& !document.body.classList.contains('record-motion-off');
 window.VinylSleeve={async open(t,enter){
  if(busy)return;
  if(!allowed()){enter();return}
  busy=true;
  const layer=document.createElement('div');layer.className='extraction-layer';layer.setAttribute('role','dialog');layer.setAttribute('aria-label','取出 '+t.title+' 的唱片');layer.setAttribute('aria-modal','true');
  const scene=document.createElement('div');scene.className='extraction-scene';
  const disc=document.createElement('div');disc.className='extraction-disc';
  const jacket=document.createElement('div');jacket.className='extraction-jacket';
  const title=document.createElement('p');title.className='extraction-title';title.textContent=t.title;
  const skip=document.createElement('button');skip.type='button';skip.className='outline extraction-skip';skip.textContent='略過動畫';
  const cover=t.cover?.data||t.image;
  if(cover){const img=document.createElement('img');img.src=cover;img.alt='';applyCoverStyle(img,t.cover);jacket.append(img)}else jacket.textContent=t.title;
  const label=document.createElement('div');label.className='extraction-label';if(cover){const img=document.createElement('img');img.src=cover;img.alt='';applyCoverStyle(img,t.cover);label.append(img)}else label.textContent=t.title;
  disc.append(label);scene.append(disc,jacket);layer.append(scene,title,skip);document.body.append(layer);
  const previous=document.activeElement;skip.focus();let done=false,timer;
  function finish(){if(done)return;done=true;clearTimeout(timer);document.removeEventListener('keydown',keys);layer.remove();busy=false;enter()}
  function keys(e){if(e.key==='Escape'){e.preventDefault();finish()}else if(e.key==='Tab'){e.preventDefault();skip.focus()}}
  document.addEventListener('keydown',keys);skip.onclick=finish;
  // Hard deadline prevents slow artwork from blocking selection.
  timer=setTimeout(finish,1800);
  try{
   const d=window.VinylCustom.safeDesign(t.vinylDesign);
   if(d){
    const art=await Promise.race([window.VinylMaterial.render(d,640,'extract'),new Promise(resolve=>setTimeout(()=>resolve(null),400))]);
    if(done)return;
    if(art){disc.style.backgroundImage=`url("${art}")`;disc.style.backgroundColor=d.translucent===false?'#ddd':'#e7e8df';}
    if(d.pattern==='image'){disc.style.backgroundSize=(100*Math.max(1,d.imageRatio||1)*(d.imageZoom||1))+'% auto';disc.style.backgroundPosition=`${d.imageX??50}% ${d.imageY??50}%`}
    if(d.pattern==='liquid'&&window.VinylLiquidField){const field=new VinylLiquidField(80);field.reset(d.amount/100,d.seed);const canvas=document.createElement('canvas');canvas.width=canvas.height=640;canvas.className='extraction-liquid';canvas.getContext('2d').drawImage(field.draw(d.color,d.accent,d.opacity),0,0,640,640);disc.prepend(canvas)}
   }
   if(done)return;
   layer.classList.add('extracting');
   await disc.animate([{transform:'translateX(0) rotate(-8deg)'},{transform:'translateX(63%) rotate(8deg)'}],{duration:650,fill:'forwards',easing:'cubic-bezier(.22,.7,.22,1)'}).finished;
   if(done)return;
   await layer.animate([{opacity:1},{opacity:0}],{duration:160,fill:'forwards'}).finished;
   finish();
  }catch{finish()}
 }};
})();

;

// 功能區段：playback-modes.js
(()=>{let mode='sequence';const valid=['sequence','single','album','random'];try{const saved=localStorage.getItem('vinyl-room.playback-mode.v1');if(valid.includes(saved))mode=saved}catch{}const label=document.createElement('label');label.className='playback-mode';const caption=document.createElement('span');caption.className='playback-mode-caption';caption.append(document.createTextNode('播放'),document.createElement('br'),document.createTextNode('模式'));label.append(caption);const menu=document.createElement('select');menu.setAttribute('aria-label','播放模式');for(const [value,text] of [['sequence','依唱片架順序'],['single','單曲循環'],['album','專輯循環'],['random','隨機專輯']]){const option=document.createElement('option');option.value=value;option.textContent=text;menu.append(option)}menu.value=mode;menu.onchange=()=>{mode=menu.value;try{localStorage.setItem('vinyl-room.playback-mode.v1',mode)}catch{}notify('播放模式已更新，下一首起套用');};label.append(menu);document.getElementById('spotifyPlayerConnection').before(label);window.VinylModes={value:()=>mode};})();

;

// 功能區段：collection-manager.js
(()=>{const button=document.createElement('button');button.className='outline';button.type='button';button.textContent='管理收藏';document.getElementById('openAlbum').after(button);const dialog=document.createElement('dialog');dialog.className='collection-manager';const title=document.createElement('h2');title.textContent='多選移除收藏';const list=document.createElement('div');const actions=document.createElement('div');actions.className='collection-manager-actions';const all=document.createElement('button'),cancel=document.createElement('button'),removeButton=document.createElement('button');for(const b of [all,cancel,removeButton]){b.type='button';b.className='outline'}all.textContent='全選／取消全選';cancel.textContent='取消';actions.append(all,cancel,removeButton);dialog.append(title,list,actions);document.body.append(dialog);let chosen=new Set();function update(){removeButton.textContent=`移除已選 ${chosen.size} 張`;removeButton.disabled=!chosen.size}button.onclick=()=>{chosen=new Set();list.replaceChildren();for(const t of tracks){const label=document.createElement('label');label.className='collection-manager-item';const input=document.createElement('input');input.type='checkbox';input.value=t.id;input.onchange=()=>{if(input.checked)chosen.add(t.id);else chosen.delete(t.id);update()};const text=document.createElement('span');text.textContent=t.title+(t.artist?' · '+t.artist:'');label.append(input,text);list.append(label)}update();dialog.showModal()};all.onclick=()=>{const select=chosen.size!==tracks.length;chosen=new Set(select?tracks.map(t=>t.id):[]);list.querySelectorAll('input').forEach(i=>i.checked=select);update()};cancel.onclick=()=>dialog.close();removeButton.onclick=()=>{if(!chosen.size)return;const old=tracks;tracks=tracks.filter(t=>!chosen.has(t.id));if(!persist()){tracks=old;return}if(chosen.has(selected.id))select(tracks[0]||emptyRecord);else render();window.VinylRoomUI.showLibrary();dialog.close();notify(`已移除 ${old.length-tracks.length} 張收藏`)}})();

;

// 功能區段：collection-menu.js
/* Dismiss fixed album menus when their original position is no longer relevant. */
(()=>{
 const openMenus=()=>document.querySelectorAll('.record-menu[open]');
 function close(except){for(const menu of openMenus())if(menu!==except)menu.open=false}
 document.addEventListener('pointerdown',event=>close(event.target.closest?.('.record-menu')),true);
 document.addEventListener('scroll',()=>close(),{capture:true,passive:true});
 document.addEventListener('wheel',()=>close(),{capture:true,passive:true});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menus=[...openMenus()];if(!menus.length)return;const focused=menus.find(menu=>menu.contains(document.activeElement));close();focused?.querySelector('summary')?.focus()}},true);
 window.addEventListener('resize',()=>close(),{passive:true});
})();

;

// 功能區段：spotify-backup.js
'use strict';
function spotifyBackup(){return JSON.stringify({platform:'spotify',version:2,exportedAt:new Date().toISOString(),tracks},null,2)}
function downloadSpotifyBackup(){const url=URL.createObjectURL(new Blob([spotifyBackup()],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='vinyl-room-spotify-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);notify('已送出 Spotify 收藏備份下載')}
$('export').onclick=downloadSpotifyBackup;$('footerBackup').onclick=downloadSpotifyBackup;
const copyDialog=document.createElement('dialog');copyDialog.innerHTML='<div class="dialog-head"><h2>Spotify 收藏備份文字</h2><button class="icon" type="button">✕</button></div><p>如未能下載，複製文字並以 UTF-8 儲存成 .json。</p><textarea readonly rows="10" style="width:100%;box-sizing:border-box"></textarea><button type="button" class="solid">複製完整備份</button><p role="status"></p>';document.body.append(copyDialog);
copyDialog.querySelector('.icon').onclick=()=>copyDialog.close();
copyDialog.querySelector('.solid').onclick=async()=>{const area=copyDialog.querySelector('textarea');try{await navigator.clipboard.writeText(area.value);copyDialog.querySelector('[role=status]').textContent='已複製。'}catch{area.focus();area.select();copyDialog.querySelector('[role=status]').textContent='請按 Ctrl+C 複製。'}};
$('backupText').onclick=()=>{copyDialog.querySelector('textarea').value=spotifyBackup();copyDialog.showModal()};
$('import').onclick=()=>$('importFile').click();
$('importFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>30000000)throw Error('備份超過 30 MB。');const data=JSON.parse(await file.text());if(data.platform!=='spotify'||![1,2].includes(data.version)||!Array.isArray(data.tracks)||!data.tracks.every(validTrack))throw Error('請選擇 Spotify 版的收藏 JSON；YouTube 收藏不會自動轉換。');const old=tracks;tracks=[...tracks,...data.tracks.filter(t=>!tracks.some(x=>x.spotifyId===t.spotifyId&&x.type===t.type))];if(tracks.length>200||!persist()){tracks=old;throw Error('匯入後超過 200 張，或瀏覽器儲存空間不足。')}render();notify('Spotify 收藏已匯入。')}catch(err){notify(err instanceof SyntaxError?'不是有效的 JSON 檔案。':err.message)}finally{e.target.value=''}};

;

// 功能區段：spotify-library.js
'use strict';
// Imports a user's saved albums into this site's separate browser collection.
// Only user-library-read is requested; Spotify's own library is not modified.
(() => {
  const addForm=$('spotifyAddForm');
  const divider=document.createElement('p');
  divider.className='spotify-import-divider';
  divider.textContent='或';
  const openButton=document.createElement('button');
  openButton.type='button';
  openButton.className='outline spotify-import-entry';
  openButton.textContent='從我的 Spotify 收藏專輯匯入 ↗';
  addForm.append(divider,openButton);

  const dialog=document.createElement('dialog');
  dialog.id='savedAlbumsDialog';
  dialog.innerHTML='<div class="dialog-head"><div><span class="eyebrow">YOUR SPOTIFY LIBRARY</span><h2>匯入收藏專輯</h2></div><button type="button" id="savedClose" class="icon" aria-label="關閉">✕</button></div><p class="field-note">讀取 Spotify「你的音樂」中已收藏的專輯，匯入到這裡的唱片架。原本手動加入的唱片、封面與 DIY 設定會保留；不會改動 Spotify 收藏。</p><p id="savedStatus" role="status" class="saved-status"></p><button type="button" id="savedConnect" class="outline" hidden>連接 Spotify 並允許讀取收藏</button><div id="savedActions" class="saved-actions" hidden><button type="button" id="savedSelectAll" class="text-button">選取全部可匯入</button><button type="button" id="savedSelectNone" class="text-button">取消全選</button><span id="savedCount"></span></div><div id="savedList" class="saved-album-list" role="group" aria-label="Spotify 收藏專輯清單"></div><button type="button" id="savedImport" class="solid" hidden>匯入選取的專輯</button>';
  document.body.append(dialog);
  const q=id=>document.getElementById(id);
  let albums=[],busy=false,loading=false;
  function status(s){q('savedStatus').textContent=s}
  function scopesReady(){return auth?.scope?.split(/\s+/).includes('user-library-read')}
  function selected(){return [...q('savedList').querySelectorAll('input[type=checkbox]:checked:not(:disabled)')].map(x=>x.value)}
  function updateCount(){const n=selected().length,available=Math.max(0,200-tracks.length);q('savedCount').textContent=`已選 ${n} 張 · 唱片架還可加入 ${available} 張`;q('savedImport').disabled=busy||loading||n===0||n>available;q('savedImport').textContent=n>available?'超過唱片架容量，請減少勾選':`匯入選取的 ${n} 張專輯`}
  function setBusy(on){busy=on;q('savedClose').disabled=on;q('savedSelectAll').disabled=on;q('savedSelectNone').disabled=on;q('savedList').querySelectorAll('input').forEach(el=>el.disabled=on||tracks.some(t=>t.type==='album'&&t.spotifyId===el.value));updateCount()}
  function render(){const list=q('savedList');list.replaceChildren();let available=0;for(const album of albums){const existing=tracks.some(t=>t.type==='album'&&t.spotifyId===album.id);if(!existing)available++;const label=document.createElement('label');label.className='saved-album'+(existing?' already-saved':'');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.value=album.id;checkbox.disabled=existing;checkbox.checked=!existing;checkbox.onchange=updateCount;const image=document.createElement('img');image.alt='';image.loading='lazy';if(album.images?.[0]?.url?.startsWith('https://'))image.src=album.images[0].url;const names=document.createElement('span');const title=document.createElement('strong');title.textContent=album.name;const details=document.createElement('small');details.textContent=(album.artists||[]).map(a=>a.name).join('、')+(existing?' · 已在唱片架':'');names.append(title,details);label.append(checkbox,image,names);list.append(label)}q('savedActions').hidden=!albums.length;q('savedImport').hidden=!albums.length;status(albums.length?`找到 ${albums.length} 張收藏專輯，${available} 張尚未加入唱片架。`:'Spotify 收藏中目前沒有專輯；仍可貼連結手動加入。');updateCount()}
  async function fetchAlbums(){if(loading)return;loading=true;q('savedActions').hidden=true;q('savedImport').hidden=true;q('savedList').replaceChildren();albums=[];let offset=0,total=0;try{do{status(`正在讀取 Spotify 收藏…已讀 ${offset}${total?' / '+total:''} 張`);const page=await api(`me/albums?limit=50&offset=${offset}`);if(!Array.isArray(page?.items))throw Error('Spotify 回傳的收藏資料格式不正確。');total=Number(page.total)||0;const ids=new Set(albums.map(x=>x.id));for(const item of page.items){const album=item?.album;if(SPOTIFY_ID.test(album?.id||'')&&!ids.has(album.id)){albums.push(album);ids.add(album.id)}}offset+=page.items.length;if(!page.next||!page.items.length)break;if(offset>=5000){status('收藏超過 5,000 張；目前先列出前 5,000 張。');break}}while(true);render()}catch(err){status('讀取失敗：'+(err.message||'請稍後重試。'));q('savedConnect').hidden=scopesReady()}finally{loading=false;updateCount()}}
  async function fetchFullAlbum(album){const data=await api('albums/'+album.id);if(!SPOTIFY_ID.test(data?.id||''))throw Error('專輯資料不可用');let items=[...(data.tracks?.items||[])],next=data.tracks?.next;while(next){const url=new URL(next);if(url.origin!=='https://api.spotify.com'||!url.pathname.startsWith('/v1/'))throw Error('曲目分頁來源不正確');const page=await api(url.pathname.slice(4)+url.search);items.push(...page.items);next=page.next}items=items.map((x,i)=>x?{...x,position:i}:null).filter(x=>x&&SPOTIFY_ID.test(x.id||'')&&typeof x.uri==='string');if(!items.length)throw Error('沒有可用的曲目');return {id:makeId(),spotifyId:data.id,type:'album',title:data.name,artist:(data.artists||[]).map(a=>a.name).join('、'),image:data.images?.[0]?.url||'',items:items.map(x=>({id:x.id,name:x.name,uri:x.uri,position:x.position})),vinylDesign:defaultVinylDesign()}}
  async function importSelected(){const ids=selected(),free=200-tracks.length;if(busy||!ids.length||ids.length>free)return;setBusy(true);let imported=0,failed=0;for(const [index,id] of ids.entries()){const album=albums.find(x=>x.id===id);if(!album||tracks.some(x=>x.type==='album'&&x.spotifyId===id))continue;status(`匯入中 ${index+1} / ${ids.length}：${album.name}`);try{const record=await fetchFullAlbum(album);tracks.push(record);if(!persist()){tracks.pop();throw Error('瀏覽器儲存空間不足')}imported++;renderCollection()}catch(err){failed++;if(/請稍後|過於頻繁|儲存空間|登入失效/.test(err.message||'')){status(`已匯入 ${imported} 張，因「${err.message}」暫停。稍後可重試，已加入的會略過。`);break}}}setBusy(false);render();if(!q('savedStatus').textContent.includes('暫停'))status(`已匯入 ${imported} 張${failed?'，'+failed+' 張暫時無法取得曲目':''}；原有收藏保持不變。`)}
  function renderCollection(){// The main app owns its shelf renderer.
    window.render?.();
  }
  function open(){if(!dialog.open)dialog.showModal();$('spotifyAddDialog').close();if(!auth||!scopesReady()){q('savedConnect').hidden=false;q('savedList').replaceChildren();q('savedActions').hidden=true;q('savedImport').hidden=true;status(auth?'需要重新授權「讀取收藏」才能匯入。':'先連接 Spotify，即可讀取你收藏的專輯。');return}q('savedConnect').hidden=true;fetchAlbums()}
  openButton.onclick=open;
  q('savedClose').onclick=()=>{if(!busy)dialog.close()};
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault()});
  q('savedConnect').onclick=()=>login(true).catch(error);
  q('savedSelectAll').onclick=()=>{q('savedList').querySelectorAll('input:not(:disabled)').forEach(el=>el.checked=true);updateCount()};
  q('savedSelectNone').onclick=()=>{q('savedList').querySelectorAll('input:not(:disabled)').forEach(el=>el.checked=false);updateCount()};
  q('savedImport').onclick=importSelected;
  window.SpotifySavedLibrary={open};
})();

;
// 雲端同步：固定載入版本，只有公開金鑰留在前端；資料權限由資料庫驗證。
(()=>{
const cloudUrl='https://flagnozpqwcmeyubhvfj.supabase.co',cloudKey='sb_publishable_XWsD8YUa3jMUZV5pjI7FyA_XnbrcXSg';
let client=null,loading=null,busy=false,cloudUser=null;
const status=message=>{$('cloudStatus').textContent=message};
function controls(){for(const id of ['cloudUpload','cloudDownload','cloudLogout'])$(id).disabled=busy||!cloudUser;$('cloudSpotifyLogin').disabled=busy;}
function showUser(user){cloudUser=user;controls();status(user?'已登入：'+user.email+'。請選擇上傳或下載。':'尚未登入雲端帳號。');}
async function loadClient(){
 if(client)return client;
 if(!loading)loading=(async()=>{await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.js';script.onload=resolve;script.onerror=()=>reject(Error('無法載入雲端連線程式，請檢查網路。'));document.head.append(script)});client=window.supabase.createClient(cloudUrl,cloudKey,{auth:{storageKey:'vinyl-room.cloud.session.v1',detectSessionInUrl:true,flowType:'implicit'}});client.auth.onAuthStateChange((_event,session)=>showUser(session?.user||null));const {data,error}=await client.auth.getSession();if(error)throw error;showUser(data.session?.user||null);return client})().catch(err=>{loading=null;throw err});
 return loading;
}
async function run(action){if(busy)return;busy=true;controls();try{await action()}catch(err){status(err.message?.startsWith('雲端')||err.message?.startsWith('請')||err.message?.startsWith('本機')?err.message:'操作未完成，請確認帳號、密碼、驗證信與網路後重試。')}finally{busy=false;controls();}}
async function currentUser(){const {data,error}=await client.auth.getUser();if(error||!data.user)throw Error('請重新登入雲端帳號。');return data.user;}
async function readCloud(user){const {data,error}=await client.from('vinyl_collections').select('tracks,revision,updated_at').eq('user_id',user.id).maybeSingle();if(error)throw error;return data;}
// 登入返回時自動接收雲端工作階段，不必再次點開視窗。
if(new URLSearchParams(location.hash.slice(1)).has('access_token')){$('cloudDialog').showModal();run(loadClient);}
$('openCloud').onclick=()=>{$('cloudDialog').showModal();run(loadClient)};
$('closeCloud').onclick=()=>$('cloudDialog').close();
// 網站入口使用相對路徑，支援 GitHub Pages 的儲存庫子路徑。
$('cloudSpotifyLogin').onclick=()=>run(async()=>{
 if(location.protocol!=='https:')throw Error('請先使用正式網站網址，再登入雲端收藏。');
 await loadClient();
 const {error}=await client.auth.signInWithOAuth({provider:'spotify',options:{redirectTo:new URL('./',location.href).href}});
 if(error)throw error;
});
$('cloudLogout').onclick=()=>run(async()=>{const {error}=await client.auth.signOut();if(error)throw error;showUser(null)});
$('cloudUpload').onclick=()=>run(async()=>{
 const user=await currentUser(),snapshot=JSON.parse(JSON.stringify(tracks));
 if(!snapshot.every(validTrack))throw Error('本機收藏格式有誤，請先備份並檢查。');
 if(new Blob([JSON.stringify(snapshot)]).size>19000000)throw Error('本機收藏含圖片超過同步上限，請減少圖片大小。');
 const old=await readCloud(user);
 if(!confirm('將本機 '+snapshot.length+' 張收藏儲存到雲端'+(old?'，取代雲端的 '+old.tracks.length+' 張收藏':'')+'？'))return;
 const row={user_id:user.id,tracks:snapshot,revision:(old?.revision||0)+1,updated_at:new Date().toISOString()};
 // 用版本條件避免另一台電腦同時更新時被覆蓋。
 let result;if(old)result=await client.from('vinyl_collections').update(row).eq('user_id',user.id).eq('revision',old.revision).select('revision');else result=await client.from('vinyl_collections').insert(row).select('revision');
 if(result.error){if(result.error.code==='23505')throw Error('雲端已被其他裝置更新，請重新操作。');throw result.error;}
 if(!result.data?.length)throw Error('雲端已被其他裝置更新，請重新操作。');status('已上傳 '+snapshot.length+' 張收藏與 DIY 設計。');
});
$('cloudDownload').onclick=()=>run(async()=>{
 const user=await currentUser(),before=JSON.stringify(tracks),remote=await readCloud(user);
 if(!remote){status('雲端還沒有收藏，請先從原本裝置上傳。');return;}
 if(!Array.isArray(remote.tracks)||remote.tracks.length>200||!remote.tracks.every(validTrack))throw Error('雲端收藏格式有誤，未修改本機資料。');
 if(!confirm('使用雲端的 '+remote.tracks.length+' 張收藏取代目前本機唱片架？下載前會保留本機快照。'))return;
 if(JSON.stringify(tracks)!==before)throw Error('本機收藏已變更，請重新下載。');
 // 先保存還原快照；儲存空間不足時直接停止，不修改唱片架。
 localStorage.setItem('vinyl-room.cloud.before-download.v1',before);
 const previous=tracks;tracks=remote.tracks;if(!persist()){tracks=previous;throw Error('本機儲存空間不足，未套用雲端收藏。');}
 select(tracks[0]||emptyRecord);window.VinylRoomUI?.showLibrary();status('已下載 '+tracks.length+' 張收藏與 DIY 設計。');
});
})();


// 匿名問卷使用獨立請求，不帶 Spotify 或雲端帳號的登入憑證。
(()=>{
const form=document.getElementById('surveyForm'),dialog=document.getElementById('surveyDialog'),button=document.getElementById('submitSurvey'),message=document.getElementById('surveyStatus');
let sending=false,submitted=false,requestId=crypto.randomUUID(),submittedBody=null;
for(const id of ['openSurveyHeader','openSurveyShelf'])document.getElementById(id).onclick=()=>dialog.showModal();
document.getElementById('closeSurvey').onclick=()=>dialog.close();
document.getElementById('surveySuggestion').oninput=e=>document.getElementById('surveyCount').textContent=e.target.value.length;
form.onsubmit=async event=>{
 event.preventDefault();if(sending||submitted||!form.reportValidity())return;
 const values=new FormData(form),answers={frequency:values.get('frequency'),ease:Number(values.get('ease')),favorite:values.get('favorite'),intention:Number(values.get('intention')),suggestion:String(values.get('suggestion')||'').trim()};
 // 相同答案重試沿用同一編號，避免逾時後重送造成重複回覆。
 const fingerprint=JSON.stringify(answers);if(submittedBody!==null&&submittedBody!==fingerprint)requestId=crypto.randomUUID();submittedBody=fingerprint;
 sending=true;button.disabled=true;button.textContent='送出中…';message.textContent='正在儲存你的回饋，請稍候。';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{
 const response=await fetch('https://flagnozpqwcmeyubhvfj.supabase.co/rest/v1/vinyl_survey_responses',{method:'POST',credentials:'omit',headers:{apikey:'sb_publishable_XWsD8YUa3jMUZV5pjI7FyA_XnbrcXSg','Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({id:requestId,...answers}),signal:controller.signal});
 if(!response.ok){const failure=await response.json().catch(()=>({}));if(!(response.status===409&&failure.code==='23505'))throw Error('儲存未完成');}
 submitted=true;form.hidden=true;message.textContent='謝謝你的回饋！你的答案已成功送出，會作為拾音室改善的參考。';message.focus();
 }catch{message.textContent='目前無法確認送出成功，答案已保留。請檢查網路後再按一次送出。';}
 finally{clearTimeout(timer);sending=false;button.disabled=submitted;button.textContent='送出回饋';}
};
})();
