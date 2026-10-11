'use strict';
/* =========================================================
 * お見合い稽古（omiai-keiko）フロントエンド
 * GitHub Pages + GAS + Gemini / Gemini TTS
 * 接続先URLとバージョンは config.js で設定
 * ========================================================= */
const CFG = window.APP_CONFIG || {};
const APP_VERSION = CFG.APP_VERSION || '0.0.0';
const BUILD_DATE = CFG.BUILD_DATE || '';
const GAS_URL = CFG.GAS_URL || '';

const QUESTIONS = [
  { cat: '自分のこと', q: 'まずはあなたのことを教えてください。周りの人からは、どんな性格だと言われますか？' },
  { cat: '自分のこと', q: '休みの日はどんなふうに過ごしていますか？趣味や夢中になっていることも教えてください。' },
  { cat: '自分のこと', q: '普段の生活リズムを教えてください。仕事の時間、食事、お酒やたばこなども。' },
  { cat: 'お相手と結婚観', q: 'お相手に求める条件で、これだけは譲れないということは何ですか？' },
  { cat: 'お相手と結婚観', q: '逆に、ここは気にしないという点はありますか？' },
  { cat: 'お相手と結婚観', q: '結婚したら、どんな毎日を送りたいですか？仕事や家事、住む場所、子どもについての考えも聞かせてください。' },
  { cat: '好みのタイプ', q: 'これまで好きになった人には、どんな共通点がありますか？' },
  { cat: '好みのタイプ', q: '希望するお相手の年齢層を教えてください。たとえば、30代前半、のように。' },
  { cat: '好みのタイプ', q: '最後に、婚活で不安に思っていることがあれば教えてください。' }
];
const EXPRS = ['normal', 'smile', 'surprise', 'trouble'];
const PRO_INFO = {
  stylist: '場所と季節に合う服装、色合わせ、サイズ感、清潔感のチェックポイントを提案します。',
  hair: '顔の形や年代に合う髪型、美容院での伝え方、スタイリング剤と当日の整え方を提案します。',
  makeup: '肌のトーン、眉、ナチュラルメイクの手順を提案します。',
  makeupMale: '肌の保湿、眉、ひげ・爪・においなど、清潔感を上げる身だしなみを提案します。'
};

/* ---------- 小道具 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jget = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
const jset = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const yen = n => '¥' + Number(n || 0).toLocaleString('ja-JP');

/* ---------- 状態 ---------- */
const S = {
  token: localStorage.getItem('ok_token') || '',
  user: jget('ok_user', null),
  mode: localStorage.getItem('ok_mode') || 'male',
  profile: null,
  partner: null,
  answers: jget('ok_answers', null) || QUESTIONS.map(() => ''),
  qIndex: 0,
  hearingActive: false,
  pro: 'stylist',
  adviceCache: {},
  omiai: null,
  lastResult: null,
  logs: null,
  busy: false,
  chatBusy: false,
  view: 'auth',
  serverVersion: '',
  avatarList: null,
  photoChoice: localStorage.getItem('ok_photo') || 'auto'
};

/* ---------- 表示まわり ---------- */
function loading(msg) { $('#loadingMsg').textContent = msg || '少しお待ちください'; $('#loading').hidden = false; }
function done() { $('#loading').hidden = true; }
let toastTimer;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, err ? 5200 : 3200);
}
/* ---------- バージョン情報 ---------- */
function maskUrl(u) {
  const m = /\/s\/([^/]+)\/exec/.exec(u || '');
  if (!m) return u || '未設定';
  const id = m[1];
  return '…/s/' + id.slice(0, 6) + '…' + id.slice(-6) + '/exec';
}
function setServerVersion(v) {
  if (v) S.serverVersion = v;
  renderVersion();
}
function renderVersion() {
  const sv = S.serverVersion;
  const minor = v => String(v).split('.').slice(0, 2).join('.');
  const mismatch = !!sv && minor(sv) !== minor(APP_VERSION);
  const badge = $('#verBadge');
  badge.textContent = 'v' + APP_VERSION;
  badge.classList.toggle('mismatch', mismatch);
  $('#ver').textContent = 'アプリ v' + APP_VERSION + (sv ? '／サーバー v' + sv : '');
  $('#vApp').textContent = 'v' + APP_VERSION;
  $('#vDate').textContent = BUILD_DATE || '—';
  $('#vServer').textContent = sv ? 'v' + sv : (GAS_URL ? '確認中…' : '未接続');
  $('#vUrl').textContent = maskUrl(GAS_URL);
  const warn = $('#vWarn');
  if (!GAS_URL) { warn.hidden = false; warn.textContent = 'config.js に GAS_URL が設定されていません。'; }
  else if (mismatch) { warn.hidden = false; warn.textContent = 'アプリとサーバーのバージョンが違います。Code.gs の更新と再デプロイが済んでいるか確認してください。'; }
  else warn.hidden = true;
}
function renderChangelog() {
  const log = CFG.CHANGELOG || [];
  $('#vLog').innerHTML = log.length
    ? log.map(c => '<li><b>v' + esc(c.version) + '</b><span>' + esc(c.date) + '</span><ul>' +
        (c.notes || []).map(n => '<li>' + esc(n) + '</li>').join('') + '</ul></li>').join('')
    : '<li class="muted">記録はありません</li>';
}
function openVersion() {
  renderVersion();
  const d = $('#verDialog');
  if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  if (!S.serverVersion) checkServer();
}
async function checkServer() {
  if (!GAS_URL) { renderVersion(); return; }
  try {
    const res = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'ping' }) });
    const j = await res.json();
    if (j.version) setServerVersion(j.version);
  } catch (e) {
    $('#vServer').textContent = '接続できません';
  }
}

/* ---------- API ---------- */
// 一時的なエラー時に自動で再送しない操作（メール送信や記録の重複を防ぐ）
const NO_RETRY = ['register', 'resetPassword', 'login', 'finishOmiai', 'createPartner'];
function gasErrorDetail(text, status) {
  const plain = String(text || '')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const m = /(Exception:[^。]{0,80}|エラー[^。]{0,60}|Error[^.]{0,80})/i.exec(plain);
  return m ? '（' + m[1].trim() + '）' : (status ? '（コード ' + status + '）' : '');
}
async function api(action, data) {
  if (!GAS_URL) throw new Error('接続先が設定されていません。config.js の GAS_URL を確認してください');
  const body = JSON.stringify(Object.assign({ action: action, token: S.token }, data || {}));
  const tries = NO_RETRY.includes(action) ? 1 : 3;
  let lastErr = null;
  for (let t = 0; t < tries; t++) {
    if (t) await new Promise(r => setTimeout(r, 1200 * t));
    let res, text;
    try {
      res = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, cache: 'no-store' });
      text = await res.text();
    } catch (e) {
      lastErr = new Error('サーバーにつながりません。通信状況を確認してください');
      continue;
    }
    let j;
    try { j = JSON.parse(text); } catch (e) {
      console.warn('[GAS応答]', action, res.status, String(text).slice(0, 800));
      lastErr = new Error('サーバーで一時的なエラーが起きました' + gasErrorDetail(text, res.status) + '。もう一度試してください');
      continue;
    }
    if (j.version) setServerVersion(j.version);
    if (!j.ok) {
      if (j.error === 'SESSION_EXPIRED') {
        logoutLocal();
        throw new Error('ログインの有効期限が切れました。もう一度ログインしてください');
      }
      throw new Error(j.error || 'エラーが発生しました');
    }
    return j;
  }
  throw lastErr || new Error('エラーが発生しました');
}
async function run(msg, fn) {
  if (S.busy) return false;
  S.busy = true;
  loading(msg);
  try { await fn(); return true; }
  catch (e) { toast(e.message, true); return false; }
  finally { S.busy = false; done(); }
}

/* ---------- 画面遷移 ---------- */
const VIEWS = ['auth', 'password', 'hearing', 'styling', 'omiai', 'result'];
function show(v) {
  if (v !== 'omiai') { Voice.stop(); Mic.abort(); }
  VIEWS.forEach(n => { $('#view-' + n).hidden = n !== v; });
  S.view = v;
  $$('#steps [data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === v ? 'step' : 'false'));
  if (['hearing', 'styling', 'omiai', 'result'].includes(v)) localStorage.setItem('ok_view', v);
  window.scrollTo({ top: 0 });
}
function go(v) {
  if (!S.token) return show('auth');
  if (v === 'hearing') openHearing();
  else if (v === 'styling') openStyling();
  else if (v === 'omiai') openOmiai();
  else if (v === 'result') openResult();
}
function markProgress() {
  const p = Number((S.user && S.user.progress) || 0);
  $$('#steps li').forEach((li, i) => li.classList.toggle('done', p > i));
}

/* ---------- モード ---------- */
function setMode(m, silent) {
  S.mode = m === 'female' ? 'female' : 'male';
  localStorage.setItem('ok_mode', S.mode);
  document.body.dataset.mode = S.mode;
  $$('[data-mode-btn]').forEach(b => {
    const on = b.dataset.modeBtn === S.mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const male = S.mode === 'male';
  $('#makeupLabel').textContent = male ? 'メイクリスト' : 'メイクリスト';
  $('#makeupSub').textContent = male ? '肌・眉・身だしなみ' : '肌・眉・メイク';
  updateProDesc();
  if (S.view === 'styling') renderCachedAdvice();
  if (S.view === 'omiai' && !$('#omiaiSetup').hidden) renderPartnerCard();
  if (!silent) toast((male ? '男性' : '女性') + 'モードにしました。アドバイスとお相手に反映されます');
}

/* ---------- 認証 ---------- */
function saveSession(token, user) {
  S.token = token; S.user = user;
  localStorage.setItem('ok_token', token);
  jset('ok_user', user);
}
function logoutLocal() {
  S.token = ''; S.user = null; S.profile = null; S.partner = null; S.omiai = null; S.lastResult = null; S.logs = null;
  localStorage.removeItem('ok_token');
  jset('ok_user', null);
  $('#account').hidden = true;
  $('#steps').hidden = true;
  show('auth');
}
async function enter() {
  $('#account').hidden = false;
  $('#nick').textContent = S.user.nickname + ' さん';
  if (S.user.mustChange) { $('#steps').hidden = true; show('password'); return; }
  $('#steps').hidden = false;
  markProgress();
  await run('会員情報を読み込んでいます', async () => {
    const j = await api('getProfile');
    S.user = j.user; jset('ok_user', j.user);
    S.profile = j.profile; S.partner = j.partner;
    markProgress();
  });
  if (!S.token) return;
  const last = localStorage.getItem('ok_view');
  go(!S.profile ? 'hearing' : (last || 'styling'));
}
function switchAuthTab(name) {
  $$('[data-auth-tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.authTab === name ? 'true' : 'false'));
  $$('[data-auth]').forEach(f => { f.hidden = f.dataset.auth !== name; });
}
function bindAuth() {
  $$('[data-auth-tab]').forEach(b => b.addEventListener('click', () => switchAuthTab(b.dataset.authTab)));
  $$('.pw-toggle').forEach(b => b.addEventListener('click', () => {
    const inp = document.getElementById(b.dataset.for);
    const showPw = inp.type === 'password';
    inp.type = showPw ? 'text' : 'password';
    b.textContent = showPw ? '隠す' : '表示';
  }));

  $('#formLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const ok = await run('ログインしています', async () => {
      const j = await api('login', { email: $('#liEmail').value, password: $('#liPass').value });
      saveSession(j.token, j.user);
      if (j.user.gender) setMode(j.user.gender, true);
      $('#liPass').value = '';
    });
    if (ok && S.token) enter();
  });

  $('#formRegister').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#rgEmail').value;
    const gender = ($('input[name=rgGender]:checked') || {}).value || 'male';
    const ok = await run('登録しています', async () => {
      const j = await api('register', { email: email, nickname: $('#rgNick').value, gender: gender, ageGroup: $('#rgAge').value });
      toast(j.message);
    });
    if (ok) {
      setMode(gender, true);
      $('#liEmail').value = email;
      switchAuthTab('login');
      $('#liPass').focus();
    }
  });
  $$('input[name=rgGender]').forEach(r => r.addEventListener('change', () => setMode(r.value, true)));

  $('#formReset').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#rsEmail').value;
    const ok = await run('再発行しています', async () => {
      const j = await api('resetPassword', { email: email });
      toast(j.message);
    });
    if (ok) { $('#liEmail').value = email; switchAuthTab('login'); }
  });

  $('#formChange').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#cpNew').value !== $('#cpNew2').value) { toast('確認用のパスワードが一致しません', true); return; }
    const ok = await run('パスワードを設定しています', async () => {
      const j = await api('changePassword', { currentPassword: $('#cpCurrent').value, newPassword: $('#cpNew').value });
      S.user = j.user; jset('ok_user', j.user);
    });
    if (ok) {
      ['#cpCurrent', '#cpNew', '#cpNew2'].forEach(s => { $(s).value = ''; });
      toast('パスワードを設定しました');
      enter();
    }
  });

  $('#btnLogout').addEventListener('click', async () => {
    try { await api('logout'); } catch (_) {}
    logoutLocal();
    toast('ログアウトしました');
  });
}

/* ---------- 音声入力 ---------- */
const Mic = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // Android の Chrome は continuous=true だと同じ文を何度も返すため、1発話ごとに作り直す
  const isAndroid = /Android/i.test(navigator.userAgent);
  let rec = null, isActive = false, wantStop = false, committed = '', sessionText = '', silenceTimer = null, opts = {};

  // 1回の認識結果をまとめる（「ありがとう」「ありがとうございます」のような積み上げ・重複を除く）
  function joinResults(results) {
    const out = [];
    for (let i = 0; i < results.length; i++) {
      const t = String(results[i][0].transcript || '').trim();
      if (!t) continue;
      const prev = out[out.length - 1];
      if (prev !== undefined && t.indexOf(prev) === 0) out[out.length - 1] = t;
      else if (prev !== undefined && prev.indexOf(t) === 0) continue;
      else if (out.indexOf(t) >= 0) continue;
      else out.push(t);
    }
    return out.join(' ');
  }
  // 同じ言い回しの連続（4文字以上）をひとつにする
  function collapse(str) {
    let s = String(str || '').replace(/\s+/g, ' ').trim();
    let prev;
    do { prev = s; s = s.replace(/(.{4,}?)(?:\s?\1)+/g, '$1'); } while (s !== prev);
    return s;
  }
  function current() { return collapse((committed + ' ' + sessionText).trim()); }
  function commit() {
    const t = sessionText.trim();
    sessionText = '';
    if (!t) return;
    if (committed && (committed === t || committed.slice(-t.length) === t)) return;
    if (committed && t.indexOf(committed) === 0) { committed = t; return; }
    committed = committed ? committed + ' ' + t : t;
  }
  function finish() {
    if (!isActive) return;
    isActive = false;
    clearTimeout(silenceTimer);
    commit();
    const o = opts; opts = {};
    const text = current();
    if (o.onState) o.onState(false);
    if (o.onEnd) o.onEnd(text);
  }
  function resetSilence() {
    clearTimeout(silenceTimer);
    if (opts.silenceMs) silenceTimer = setTimeout(() => { if (current()) stop(); }, opts.silenceMs);
  }
  function makeRec() {
    rec = new SR();
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = !isAndroid;
    rec.maxAlternatives = 1;
    rec.onresult = e => {
      sessionText = joinResults(e.results);
      if (opts.onText) opts.onText(current(), '');
      resetSilence();
    };
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantStop = true;
        toast('マイクの使用が許可されていません。ブラウザの設定を確認してください', true);
      }
    };
    rec.onend = () => {
      commit();
      if (!wantStop && isActive) {
        try { makeRec(); rec.start(); return; } catch (_) {}
      }
      finish();
    };
  }
  function start(o) {
    if (!SR) { toast('このブラウザは音声入力に対応していません。文字で入力してください', true); return false; }
    abort();
    opts = o || {}; committed = ''; sessionText = ''; wantStop = false;
    makeRec();
    try { rec.start(); } catch (e) { toast('音声入力を開始できませんでした', true); return false; }
    isActive = true;
    if (opts.onState) opts.onState(true);
    resetSilence();
    return true;
  }
  function stop() {
    if (!rec || !isActive) return;
    wantStop = true;
    clearTimeout(silenceTimer);
    try { rec.stop(); } catch (_) { finish(); }
  }
  function abort() {
    if (!rec || !isActive) return;
    wantStop = true;
    opts.onEnd = null;
    try { rec.abort(); } catch (_) {}
    finish();
  }
  return { start: start, stop: stop, abort: abort, active: () => isActive, supported: () => !!SR };
})();
function setMicUI(btn, on) {
  btn.classList.toggle('listening', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  const label = btn.querySelector('.mic-label');
  if (label) label.textContent = on ? '聞き取り中…タップで終了' : (btn.id === 'hearMic' ? '話して答える' : '話す');
}

/* ---------- 音声出力（Gemini TTS / 端末の声）＋口パク ---------- */
const Voice = (() => {
  let ctx = null, src = null, raf = 0, flap = 0, endCb = null, warned = false;
  function unlock() {
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC(); }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }
  function stop() {
    if (src) { try { src.onended = null; src.stop(); } catch (_) {} src = null; }
    cancelAnimationFrame(raf);
    clearInterval(flap);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const cb = endCb; endCb = null;
    if (cb) cb();
  }
  function pcmToBuffer(b64, mime) {
    const rate = Number((/rate=(\d+)/.exec(mime || '') || [])[1] || 24000);
    const bin = atob(b64);
    const len = bin.length >> 1;
    const buf = ctx.createBuffer(1, len, rate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
      if (v >= 0x8000) v -= 0x10000;
      ch[i] = v / 32768;
    }
    return buf;
  }
  async function playGemini(b64, mime, rate, avatar) {
    unlock();
    stop();
    if (!ctx) throw new Error('no audio');
    let buffer;
    if (/wav|mpeg|mp3|ogg/i.test(mime || '')) {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      buffer = await ctx.decodeAudioData(bytes.buffer);
    } else {
      buffer = pcmToBuffer(b64, mime);
    }
    return new Promise(resolve => {
      src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate || 1;
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      an.connect(ctx.destination);
      const data = new Uint8Array(an.fftSize);
      let lastFlip = 0;
      if (avatar) avatar.setTalking(true);
      const tick = now => {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const d = (data[i] - 128) / 128; sum += d * d; }
        const rms = Math.sqrt(sum / data.length);
        if (avatar) {
          if (rms > 0.035) {
            if (!now || now - lastFlip > 110) { avatar.setMouth(!avatar.mouth); lastFlip = now || 0; }
          } else avatar.setMouth(false);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      endCb = () => { cancelAnimationFrame(raf); if (avatar) avatar.setTalking(false); resolve(); };
      src.onended = () => { src = null; const cb = endCb; endCb = null; if (cb) cb(); };
      src.start();
    });
  }
  function pickVoice(gender) {
    if (!('speechSynthesis' in window)) return null;
    const vs = speechSynthesis.getVoices().filter(v => /^ja/i.test(v.lang));
    if (!vs.length) return null;
    const fem = /female|kyoko|haruka|nanami|ayumi|sayaka|o-ren|女性/i;
    const mal = /male|otoya|ichiro|keita|hattori|男性/i;
    const hit = gender === 'male'
      ? vs.find(v => mal.test(v.name) && !/female/i.test(v.name))
      : vs.find(v => fem.test(v.name));
    return hit || vs[0];
  }
  function speakDevice(text, opt, avatar) {
    opt = opt || {};
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) { resolve(); return; }
      stop();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.pitch = clamp(Number(opt.pitch) || 1, 0.5, 2);
      u.rate = clamp(Number(opt.rate) || 1, 0.5, 2);
      const v = pickVoice(opt.gender);
      if (v) u.voice = v;
      endCb = () => { clearInterval(flap); if (avatar) avatar.setTalking(false); resolve(); };
      u.onstart = () => {
        if (avatar) { avatar.setTalking(true); flap = setInterval(() => avatar.setMouth(!avatar.mouth), 120); }
      };
      const end = () => { const cb = endCb; endCb = null; if (cb) cb(); };
      u.onend = end;
      u.onerror = end;
      speechSynthesis.speak(u);
    });
  }
  function flapOnly(text, avatar) {
    stop();
    return new Promise(resolve => {
      const ms = clamp(text.length * 110, 800, 6000);
      avatar.setTalking(true);
      flap = setInterval(() => avatar.setMouth(!avatar.mouth), 120);
      const t = setTimeout(() => { const cb = endCb; endCb = null; if (cb) cb(); }, ms);
      endCb = () => { clearTimeout(t); clearInterval(flap); avatar.setTalking(false); resolve(); };
    });
  }
  async function speak(text, partner, mode, avatar) {
    if (!text) return;
    if (mode === 'off') return flapOnly(text, avatar);
    if (mode === 'gemini') {
      try {
        const j = await api('tts', { text: text, voiceName: partner.voiceName, style: partner.voiceStyle });
        await playGemini(j.audio, j.mimeType, clamp(Number(partner.rate) || 1, 0.85, 1.15), avatar);
        return;
      } catch (e) {
        if (!warned) { warned = true; toast('Geminiの声を使えなかったため、端末の声で読み上げます', true); }
      }
    }
    await speakDevice(text, { gender: partner.gender, pitch: partner.pitch, rate: partner.rate }, avatar);
  }
  if ('speechSynthesis' in window) { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); }
  return { unlock: unlock, stop: stop, speak: speak, speakDevice: speakDevice };
})();

/* ---------- アバター（まどべ方式：同じ枠に全画像を重ねて切り替え） ---------- */
function hashStr(s) { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function avatarSvg(gender, seed, expr, frame) {
  const h = hashStr(seed);
  const skin = ['#F3D3BC', '#EBC3A4', '#E2B494', '#F6DCC8'][h % 4];
  const hair = ['#2B211C', '#3B2A20', '#4A3426', '#1E1A18', '#5A4030'][(h >> 3) % 5];
  const blouse = ['#E9E2D6', '#D8E1E8', '#EAD5D9', '#DDE3D3'][(h >> 5) % 4];
  const suit = ['#25334A', '#2F3640', '#3A3F4A'][(h >> 5) % 3];
  const tie = ['#7A3B45', '#3F5A7A', '#5C6B3A'][(h >> 7) % 3];
  const ink = '#2A2220';
  const female = gender !== 'male';
  const bw = female ? 3.5 : 5.5;
  const brows = {
    normal: ['M106 152 Q122 146 138 151', 'M162 151 Q178 146 194 152'],
    smile: ['M106 148 Q122 140 138 147', 'M162 147 Q178 140 194 148'],
    surprise: ['M106 141 Q122 129 138 139', 'M162 139 Q178 129 194 141'],
    trouble: ['M106 151 Q122 149 138 142', 'M162 142 Q178 149 194 151']
  }[expr] || [];
  const ry = { normal: 11, smile: 8, surprise: 13, trouble: 10 }[expr] || 11;
  const eyes = frame === 'blink'
    ? '<path d="M112 176 Q122 182 132 176" stroke="' + ink + '" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M168 176 Q178 182 188 176" stroke="' + ink + '" stroke-width="3" fill="none" stroke-linecap="round"/>'
    : [122, 178].map(x => '<ellipse cx="' + x + '" cy="176" rx="9" ry="' + ry + '" fill="' + ink + '"/><circle cx="' + (x + 3) + '" cy="' + (176 - ry / 3) + '" r="2.6" fill="#fff"/>').join('');
  const talk = frame === 'talk';
  const mouth = {
    normal: talk ? '<ellipse cx="150" cy="228" rx="11" ry="8" fill="#7A2E38"/>' : '<path d="M139 227 Q150 232 161 227" stroke="#8A3B3B" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
    smile: talk ? '<path d="M131 222 Q150 248 169 222 Z" fill="#7A2E38"/><path d="M134 223 L166 223 Q150 229 134 223Z" fill="#fff"/>' : '<path d="M132 223 Q150 240 168 223 Q150 230 132 223Z" fill="#B65A5E"/>',
    surprise: talk ? '<ellipse cx="150" cy="230" rx="9" ry="13" fill="#7A2E38"/>' : '<ellipse cx="150" cy="229" rx="6" ry="8" fill="#7A2E38"/>',
    trouble: talk ? '<ellipse cx="150" cy="230" rx="9" ry="6" fill="#7A2E38"/>' : '<path d="M138 231 Q150 223 162 231" stroke="#8A3B3B" stroke-width="3.5" fill="none" stroke-linecap="round"/>'
  }[expr];
  const blush = (expr === 'smile' || expr === 'surprise')
    ? '<ellipse cx="102" cy="202" rx="13" ry="7" fill="#E89A9A" opacity=".4"/><ellipse cx="198" cy="202" rx="13" ry="7" fill="#E89A9A" opacity=".4"/>' : '';
  const sweat = expr === 'trouble' ? '<path d="M214 134 q7 13 0 18 q-7 -5 0 -18Z" fill="#9CC7E8"/>' : '';
  const backHair = female ? '<path d="M76 172 Q66 86 150 78 Q234 86 224 172 L234 330 Q150 348 66 330Z" fill="' + hair + '"/>' : '';
  const body = female
    ? '<path d="M58 400 Q64 318 150 304 Q236 318 242 400Z" fill="' + blouse + '"/><path d="M130 305 L150 334 L170 305Z" fill="' + skin + '"/>'
    : '<path d="M48 400 Q56 316 150 302 Q244 316 252 400Z" fill="' + suit + '"/><path d="M124 304 L150 362 L176 304Z" fill="#F7F7F4"/><path d="M146 312 L154 312 L159 352 L150 364 L141 352Z" fill="' + tie + '"/>';
  const frontHair = female
    ? '<path d="M80 166 Q76 90 150 84 Q224 90 220 166 Q206 118 162 114 Q122 120 102 146 Q90 158 80 166Z" fill="' + hair + '"/>'
    : '<path d="M80 160 Q74 86 150 78 Q228 86 220 160 Q214 118 190 110 Q150 100 112 112 Q88 122 80 160Z" fill="' + hair + '"/>';
  return '<svg viewBox="0 0 300 400" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMax meet">' +
    backHair + body +
    '<rect x="128" y="232" width="44" height="80" rx="18" fill="' + skin + '"/>' +
    '<ellipse cx="80" cy="178" rx="10" ry="16" fill="' + skin + '"/><ellipse cx="220" cy="178" rx="10" ry="16" fill="' + skin + '"/>' +
    '<ellipse cx="150" cy="168" rx="70" ry="84" fill="' + skin + '"/>' +
    frontHair +
    brows.map(d => '<path d="' + d + '" stroke="' + hair + '" stroke-width="' + bw + '" fill="none" stroke-linecap="round"/>').join('') +
    eyes +
    '<path d="M150 188 Q146 202 152 205" stroke="#C99A82" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
    mouth + blush + sweat + '</svg>';
}

function preloadImg(url) {
  return new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = url; });
}
class Avatar {
  constructor(el) {
    this.el = el; this.expr = 'normal'; this.blink = false; this.mouth = false; this.talking = false;
    this.mode = 'svg'; this.gender = 'female'; this.seed = ''; this.images = null; this.layers = null; this._key = '';
    this.svgHost = null;
    this._blinkLoop();
  }
  useSvg(gender, seed) {
    this.mode = 'svg'; this.gender = gender; this.seed = seed; this.images = null;
    this.el.innerHTML = '';
    this.svgHost = document.createElement('div');
    this.svgHost.className = 'av-svg';
    this.el.appendChild(this.svgHost);
    this.render(true);
  }
  async useImages(images) {
    const names = Object.keys(images);
    await Promise.all(names.map(n => preloadImg(images[n])));
    this.el.innerHTML = '';
    this.stack = document.createElement('div');
    this.stack.className = 'av-stack photo';
    this.layers = new Map();
    this.images = {};
    names.forEach(n => this._layer(n, images[n]));
    this.el.appendChild(this.stack);
    this.svgHost = null;
    this.mode = 'img';
    this.render(true);
  }
  _layer(key, url) {
    let im = this.layers.get(key);
    if (!im) {
      im = document.createElement('img');
      im.alt = ''; im.draggable = false;
      this.stack.appendChild(im);
      this.layers.set(key, im);
    }
    im.src = url;
    this.images[key] = url;
  }
  // 写真を1枚ずつ追加（同じキーなら高画質版に差し替え）
  async addImage(key, url) {
    await preloadImg(url);
    if (this.mode !== 'img' || !this.layers) { const o = {}; o[key] = url; return this.useImages(o); }
    this._layer(key, url);
    this.render(true);
  }
  setExpr(e) { this.expr = EXPRS.includes(e) ? e : 'normal'; this.render(); }
  setTalking(on) { this.talking = on; if (!on) this.mouth = false; this.render(); }
  setMouth(open) { if (this.mouth !== open) { this.mouth = open; this.render(); } }
  frame() { return this.blink ? 'blink' : (this.talking && this.mouth ? 'talk' : 'base'); }
  _blinkLoop() {
    const next = () => {
      setTimeout(() => {
        this.blink = true; this.render();
        setTimeout(() => { this.blink = false; this.render(); next(); }, 130);
      }, 2200 + Math.random() * 3300);
    };
    next();
  }
  render(force) {
    const key = this.expr + '_' + this.frame();
    if (!force && key === this._key) return;
    this._key = key;
    if (this.mode === 'img' && this.images) {
      let k = this.images[key] ? key : (this.images[this.expr + '_base'] ? this.expr + '_base' : 'normal_base');
      if (!this.images[k]) k = Object.keys(this.images)[0];
      this.layers.forEach((img, name) => img.classList.toggle('on', name === k));
    } else if (this.svgHost) {
      this.svgHost.innerHTML = avatarSvg(this.gender, this.seed, this.expr, this.frame());
    }
  }
}
let avatar;

/* ---------- ヒアリング ---------- */
function saveAnswers() { jset('ok_answers', S.answers); }
function openHearing() {
  show('hearing');
  if (S.profile && !S.hearingActive) {
    $('#hearingQA').hidden = true;
    $('#hearingResult').hidden = false;
    renderProfile(S.profile);
  } else {
    startHearing(false);
  }
}
function startHearing(reset) {
  S.hearingActive = true;
  if (reset) { S.answers = QUESTIONS.map(() => ''); S.qIndex = 0; saveAnswers(); }
  $('#hearingQA').hidden = false;
  $('#hearingResult').hidden = true;
  renderQ();
}
function renderQ() {
  const i = S.qIndex, q = QUESTIONS[i];
  $('#qCat').textContent = q.cat;
  $('#qCount').textContent = (i + 1) + ' / ' + QUESTIONS.length;
  $('#qBar').style.width = (i / QUESTIONS.length * 100) + '%';
  $('#qText').textContent = q.q;
  $('#hearAnswer').value = S.answers[i] || '';
  $('#hearPrev').disabled = i === 0;
  $('#hearNext').textContent = i === QUESTIONS.length - 1 ? '回答をまとめる' : '次の質問へ';
  if ($('#hearSpeak').checked) Voice.speakDevice(q.q, { gender: 'female', rate: 1.05 });
}
function keepAnswer() { S.answers[S.qIndex] = $('#hearAnswer').value.trim(); saveAnswers(); }
function bindHearing() {
  $('#hearMic').addEventListener('click', () => {
    if (Mic.active()) { Mic.stop(); return; }
    Voice.stop();
    const ta = $('#hearAnswer');
    const base = ta.value.trim() ? ta.value.trim() + '\n' : '';
    Mic.start({
      onText: (f, i) => { ta.value = base + f + i; },
      onState: on => setMicUI($('#hearMic'), on),
      onEnd: f => { ta.value = base + f; keepAnswer(); }
    });
  });
  $('#hearAnswer').addEventListener('input', keepAnswer);
  $('#hearPrev').addEventListener('click', () => { Mic.abort(); keepAnswer(); if (S.qIndex > 0) { S.qIndex--; renderQ(); } });
  $('#hearRepeat').addEventListener('click', () => Voice.speakDevice(QUESTIONS[S.qIndex].q, { gender: 'female', rate: 1.0 }));
  $('#hearNext').addEventListener('click', () => {
    Mic.abort(); Voice.stop(); keepAnswer();
    if (S.qIndex < QUESTIONS.length - 1) { S.qIndex++; renderQ(); return; }
    finishHearing();
  });
  $('#hearRedo').addEventListener('click', () => startHearing(true));
}
async function finishHearing() {
  if (!S.answers.some(a => a)) { toast('ひとつ以上の質問に答えてください', true); return; }
  const ok = await run('ヒアリング内容をまとめています', async () => {
    const answers = QUESTIONS.map((q, i) => ({ cat: q.cat, q: q.q, a: S.answers[i] || '' }));
    const j = await api('structureProfile', { mode: S.mode, answers: answers });
    S.profile = j.profile;
    if (j.user) { S.user = j.user; jset('ok_user', j.user); markProgress(); }
  });
  if (!ok) return;
  S.hearingActive = false;
  $('#qBar').style.width = '100%';
  $('#hearingQA').hidden = true;
  $('#hearingResult').hidden = false;
  renderProfile(S.profile);
  toast('プロフィールを保存しました');
}
function renderProfile(p) {
  p = p || {};
  const chips = a => (a || []).filter(Boolean).map(x => '<span class="chip">' + esc(x) + '</span>').join('') || '—';
  const s = p.self || {}, w = p.wants || {}, t = p.type || {};
  const row = (k, v) => '<div><dt>' + k + '</dt><dd>' + (v || '—') + '</dd></div>';
  $('#profileView').innerHTML =
    '<h3 class="sec-title">あなたのプロフィール</h3>' +
    (p.selfIntro ? '<blockquote class="intro">' + esc(p.selfIntro) + '</blockquote>' : '') +
    '<dl class="prof">' +
    row('性格', esc(s.personality)) +
    row('趣味', chips(s.hobbies)) +
    row('生活習慣', esc(s.lifestyle)) +
    row('譲れない条件', chips(w.mustConditions)) +
    row('気にしない点', chips(w.flexiblePoints)) +
    row('結婚観', esc(w.marriageView)) +
    row('好みのタイプ', esc(t.preferredType)) +
    row('希望年齢', esc(t.ageRange)) +
    row('アピール', chips(p.appealPoints)) +
    '</dl>' +
    (p.counselorComment ? '<p class="counsel"><b>カウンセラーより</b>' + esc(p.counselorComment) + '</p>' : '');
}

/* ---------- 身だしなみ ---------- */
function updateProDesc() {
  $('#proDesc').textContent = S.pro === 'makeup' && S.mode === 'male' ? PRO_INFO.makeupMale : PRO_INFO[S.pro];
}
function openStyling() { show('styling'); updateProDesc(); renderCachedAdvice(); }
function renderCachedAdvice() {
  const a = S.adviceCache[S.pro + '_' + S.mode];
  $('#adviceOut').innerHTML = a ? renderAdvice(a) : '';
}
function renderAdvice(a) {
  const li = arr => (arr || []).map(x => '<li>' + esc(x) + '</li>').join('');
  return '<article class="advice panel">' +
    '<h3 class="sec-title">' + esc(a.title) + '</h3>' +
    '<p class="lead">' + esc(a.summary) + '</p>' +
    (a.sections || []).map(s => '<section><h4>' + esc(s.heading) + '</h4><ul>' + li(s.points) + '</ul></section>').join('') +
    (a.steps && a.steps.length ? '<section><h4>当日の手順</h4><ol>' + li(a.steps) + '</ol></section>' : '') +
    (a.checklist && a.checklist.length ? '<section><h4>出かける前のチェック</h4><ul class="checks">' +
      a.checklist.map(x => '<li><label><input type="checkbox"> ' + esc(x) + '</label></li>').join('') + '</ul></section>' : '') +
    (a.ng && a.ng.length ? '<section class="ng"><h4>避けたいこと</h4><ul>' + li(a.ng) + '</ul></section>' : '') +
    (a.items && a.items.length ? '<section><h4>そろえたいもの</h4><div class="table-wrap"><table class="items"><thead><tr><th>アイテム</th><th>選び方</th><th>目安</th></tr></thead><tbody>' +
      a.items.map(x => '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.note) + '</td><td>' + esc(x.price) + '</td></tr>').join('') +
      '</tbody></table></div></section>' : '') +
    '</article>';
}
function bindStyling() {
  $$('[data-pro]').forEach(b => b.addEventListener('click', () => {
    S.pro = b.dataset.pro;
    $$('[data-pro]').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
    updateProDesc();
    renderCachedAdvice();
  }));
  $('#btnAdvice').addEventListener('click', async () => {
    const names = { stylist: 'スタイリスト', hair: 'ヘアリスト', makeup: 'メイクリスト' };
    let result = null;
    const ok = await run('AI' + names[S.pro] + 'が考えています', async () => {
      const j = await api('advice', {
        kind: S.pro, mode: S.mode,
        situation: $('#advSituation').value, season: $('#advSeason').value,
        faceShape: $('#advFace').value, bodyType: $('#advBody').value,
        budget: $('#advBudget').value, concerns: $('#advConcern').value
      });
      result = j.advice;
      if (j.user) { S.user = j.user; jset('ok_user', j.user); markProgress(); }
    });
    if (!ok || !result) return;
    S.adviceCache[S.pro + '_' + S.mode] = result;
    $('#adviceOut').innerHTML = renderAdvice(result);
    $('#adviceOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ---------- 模擬お見合い ---------- */
function partnerMismatch() {
  if (!S.partner || S.partner.photoChosen) return false;
  const want = S.mode === 'male' ? 'female' : 'male';
  return S.partner.gender !== want;
}
function openOmiai() {
  show('omiai');
  if (S.omiai && S.omiai.live) { $('#omiaiSetup').hidden = true; $('#omiaiRoom').hidden = false; return; }
  $('#omiaiSetup').hidden = false;
  $('#omiaiRoom').hidden = true;
  renderPartnerCard();
  loadPhotoList();
}

/* お相手の写真（Driveに登録した人）を選ぶ */
async function loadPhotoList(force) {
  if (S.avatarList && !force) { renderPhotoPick(); return; }
  $('#photoPick').innerHTML = '<p class="muted small">写真を読み込んでいます…</p>';
  try {
    const j = await api('listAvatars');
    S.avatarList = j.avatars || [];
  } catch (e) {
    S.avatarList = [];
    toast(e.message, true);
  }
  renderPhotoPick();
}
function photoLabel(a) {
  return (a.gender === 'female' ? '女性' : a.gender === 'male' ? '男性' : '') + (a.ageHint ? '・' + a.ageHint : '');
}
function renderPhotoPick() {
  const list = S.avatarList || [];
  const want = S.mode === 'male' ? 'female' : 'male';
  const sorted = list.slice().sort((x, y) => (x.gender === want ? 0 : 1) - (y.gender === want ? 0 : 1));
  if (S.photoChoice !== 'auto' && S.photoChoice !== 'illust' && !list.some(a => a.id === S.photoChoice)) S.photoChoice = 'auto';
  const opt = (id, thumb, title, sub) =>
    '<button type="button" role="radio" class="photo-opt" data-photo="' + esc(id) + '" aria-checked="' + (S.photoChoice === id ? 'true' : 'false') + '">' +
    '<span class="ph">' + (thumb ? '<img src="' + thumb + '" alt="">' : '<span class="ph-icon">' + esc(title.slice(0, 1)) + '</span>') + '</span>' +
    '<b>' + esc(title) + '</b><small>' + esc(sub) + '</small></button>';
  let html = opt('auto', '', 'おまかせ', list.length ? '登録写真からランダム' : '写真がなければイラスト');
  html += opt('illust', '', 'イラスト', '写真を使わない');
  html += sorted.map(a => opt(a.id, a.thumb, a.title || a.name, photoLabel(a))).join('');
  $('#photoPick').innerHTML = html;
  $$('[data-photo]').forEach(b => b.addEventListener('click', () => {
    S.photoChoice = b.dataset.photo;
    localStorage.setItem('ok_photo', S.photoChoice);
    $$('[data-photo]').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
  }));
}
function customSpec() {
  const c = {
    name: $('#cuName').value.trim(),
    age: $('#cuAge').value.trim(),
    job: $('#cuJob').value.trim(),
    hobby: $('#cuHobby').value.trim(),
    note: $('#cuNote').value.trim()
  };
  return Object.keys(c).some(k => c[k]) ? c : null;
}
function partnerThumb(p) {
  if (!p || !p.avatarFolderId || !S.avatarList) return '';
  const a = S.avatarList.find(x => x.id === p.avatarFolderId);
  return a && a.thumb ? a.thumb : '';
}
function renderPartnerCard() {
  const p = S.partner, card = $('#partnerCard');
  $('#btnStart').hidden = !p || partnerMismatch();
  $('#btnPartner').textContent = p ? '別のお相手にする' : 'お相手を決める';
  if (!S.profile) {
    card.innerHTML = '<p class="warn">先にヒアリングでプロフィールを作ると、お相手選びの精度が上がります。</p>';
    if (!p) return;
  } else if (!p) {
    card.innerHTML = '<p class="muted">「お相手を決める」を押すと、ここにお相手の身上書が届きます。</p>';
    return;
  } else card.innerHTML = '';
  const thumb = partnerThumb(p);
  card.innerHTML +=
    (thumb ? '<img class="shinsho-photo" src="' + thumb + '" alt="' + esc(p.name) + 'さんの写真">' : '') +
    '<h3>' + esc(p.name) + '</h3>' +
    '<p class="kana">' + esc(p.kana) + '</p>' +
    (partnerMismatch() ? '<p class="warn">モードを切り替えたので、お相手を決め直してください。</p>' : '') +
    '<dl>' +
    '<div><dt>年齢</dt><dd>' + esc(p.age) + '歳</dd></div>' +
    '<div><dt>職業</dt><dd>' + esc(p.job) + '</dd></div>' +
    '<div><dt>住まい</dt><dd>' + esc(p.residence) + '</dd></div>' +
    '<div><dt>人柄</dt><dd>' + esc(p.personality) + '</dd></div>' +
    '<div><dt>趣味</dt><dd>' + (p.hobbies || []).map(x => '<span class="chip">' + esc(x) + '</span>').join('') + '</dd></div>' +
    '<div><dt>大切にしていること</dt><dd>' + esc(p.values) + '</dd></div>' +
    '<div><dt>印象</dt><dd>' + esc(p.appearance) + '</dd></div>' +
    '</dl>';
}
function saveOmiai() { if (S.omiai) jset('ok_omiai', S.omiai); }
function setAffinity(v, delta) {
  v = clamp(Math.round(v), 0, 100);
  $('#affBar').style.width = v + '%';
  $('#affNum').textContent = v;
  const d = $('#affDelta');
  d.className = '';
  d.textContent = '';
  if (delta) {
    d.textContent = (delta > 0 ? '+' : '') + delta;
    d.className = delta > 0 ? 'up' : 'down';
    setTimeout(() => { d.className = ''; }, 2200);
  }
  return v;
}
function addMsg(role, text, inner) {
  const el = document.createElement('div');
  el.className = 'msg ' + role;
  el.innerHTML = '<p>' + esc(text) + '</p>' + (role === 'partner' && inner && $('#optInner').checked ? '<span class="inner">心の声：' + esc(inner) + '</span>' : '');
  $('#chatLog').appendChild(el);
  $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
  return el;
}
function addTyping() {
  const el = document.createElement('div');
  el.className = 'msg partner typing';
  el.textContent = S.partner.name + 'さんが考えています…';
  $('#chatLog').appendChild(el);
  $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
  return el;
}
function setTalkEnabled(on) { ['#talkSend', '#talkInput', '#talkMic'].forEach(s => { $(s).disabled = !on; }); }
function say(text) { return Voice.speak(text, S.partner, $('#optVoice').value, avatar); }
function inRoom() { return S.view === 'omiai' && S.omiai && S.omiai.live && !$('#omiaiRoom').hidden; }
function afterPartnerSpoke() { if (inRoom() && $('#optHandsFree').checked && !S.chatBusy) startTalkMic(); }
function startTalkMic() {
  if (Mic.active() || S.chatBusy) return;
  const inp = $('#talkInput');
  Mic.start({
    silenceMs: Number($('#optWait').value) || 4000,
    onText: (f, i) => { inp.value = f + i; },
    onState: on => setMicUI($('#talkMic'), on),
    onEnd: f => { inp.value = f; if (f.trim()) sendTalk(f); }
  });
}
function setPhotoStatus(t) { const el = $('#photoStatus'); if (el) el.textContent = t || ''; }
async function setupAvatar(p) {
  S.avatarLoadToken = (S.avatarLoadToken || 0) + 1;
  setPhotoStatus('');
  if (!p.avatarFolderId) { avatar.useSvg(p.gender, p.name || 'x'); return; }
  // まず身上書の写真をすぐ表示し、表情写真は裏で順に読み込む
  const thumb = partnerThumb(p);
  if (thumb) await avatar.useImages({ normal_base: thumb });
  else avatar.useSvg(p.gender, p.name || 'x');
  loadAvatarImages(p.avatarFolderId, S.avatarLoadToken).catch(e => {
    setPhotoStatus('');
    toast('写真を読み込めませんでした（' + e.message + '）', true);
  });
}
async function loadAvatarImages(folderId, token) {
  const j = await api('avatarManifest', { folderId: folderId });
  const order = k => (k === 'normal_base' ? 0 : /_base$/.test(k) ? 1 : /_talk$/.test(k) ? 2 : 3);
  const queue = (j.keys || []).slice().sort((a, b) => order(a.key) - order(b.key));
  const total = queue.length;
  let count = 0;
  setPhotoStatus('写真を読み込み中 0 / ' + total);
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        const url = await getAvatarImage(folderId, item.key, item.rev);
        if (token !== S.avatarLoadToken) return;
        await avatar.addImage(item.key, url);
      } catch (e) { console.warn('写真', item.key, e.message); }
      count++;
      if (token === S.avatarLoadToken) setPhotoStatus(count < total ? '写真を読み込み中 ' + count + ' / ' + total : '');
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
// 端末に保存しておき、2回目からはすぐ表示
async function getAvatarImage(folderId, key, rev) {
  const ck = 'https://omiai-keiko.cache/avatar/' + folderId + '/' + key + '?v=' + encodeURIComponent(rev || '');
  let cache = null;
  try {
    cache = await caches.open('omiai-avatars-v1');
    const hit = await cache.match(ck);
    if (hit) return await hit.text();
  } catch (_) { cache = null; }
  const j = await api('avatarImage', { folderId: folderId, key: key });
  if (cache) { try { await cache.put(ck, new Response(j.url, { headers: { 'Content-Type': 'text/plain' } })); } catch (_) {} }
  return j.url;
}
async function enterRoom() {
  const p = S.partner;
  $('#omiaiSetup').hidden = true;
  $('#omiaiRoom').hidden = false;
  $('#pName').textContent = p.name;
  $('#pMeta').textContent = p.age + '歳・' + p.job;
  setAffinity(S.omiai.affinity, 0);
  $('#chatLog').innerHTML = '';
  $('#hint').textContent = '';
  setTalkEnabled(true);
  await setupAvatar(p);
  avatar.setExpr('normal');
  S.omiai.history.forEach(m => addMsg(m.role, m.text, m.inner));
  if (!S.omiai.history.length) {
    const line = p.firstLine || 'はじめまして。今日はよろしくお願いします。';
    S.omiai.history.push({ role: 'partner', text: line });
    addMsg('partner', line);
    saveOmiai();
    avatar.setExpr('smile');
    await say(line);
    afterPartnerSpoke();
  }
}
async function sendTalk(text) {
  text = (text || '').trim();
  if (!text || S.chatBusy || !S.omiai) return;
  Mic.abort();
  S.chatBusy = true;
  Voice.stop();
  $('#talkInput').value = '';
  setTalkEnabled(false);
  const prior = S.omiai.history.slice(-40);
  S.omiai.history.push({ role: 'user', text: text });
  const userEl = addMsg('user', text);
  const typing = addTyping();
  let reply = null;
  try {
    const j = await api('omiaiChat', {
      partner: S.partner, history: prior, message: text,
      affinity: S.omiai.affinity, turns: S.omiai.turns, mode: S.mode
    });
    const r = j.result;
    typing.remove();
    S.omiai.turns++;
    S.omiai.affinity = setAffinity(S.omiai.affinity + (Number(r.affinityDelta) || 0), Number(r.affinityDelta) || 0);
    S.omiai.history.push({ role: 'partner', text: r.reply, inner: r.innerVoice });
    addMsg('partner', r.reply, r.innerVoice);
    $('#hint').textContent = r.hint ? 'ひとこと助言：' + r.hint : '';
    avatar.setExpr(r.expression);
    saveOmiai();
    reply = r.reply;
  } catch (e) {
    typing.remove();
    userEl.remove();
    S.omiai.history.pop();
    $('#talkInput').value = text;
    toast(e.message, true);
  } finally {
    S.chatBusy = false;
    setTalkEnabled(true);
  }
  if (reply) { await say(reply); afterPartnerSpoke(); }
}
function bindOmiai() {
  $('#btnPartner').addEventListener('click', async () => {
    if (S.omiai && S.omiai.history && S.omiai.history.length > 1 && !confirm('今のお見合いの記録は消えます。別のお相手にしますか？')) return;
    const ok = await run('お相手を探しています', async () => {
      const j = await api('createPartner', {
        mode: S.mode, difficulty: $('#optDifficulty').value,
        avatarChoice: S.photoChoice, custom: customSpec()
      });
      S.partner = j.partner;
    });
    if (!ok) return;
    S.omiai = null;
    jset('ok_omiai', null);
    renderPartnerCard();
    $('#partnerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#btnReloadPhotos').addEventListener('click', () => loadPhotoList(true));
  $('#btnStart').addEventListener('click', async () => {
    if (!S.partner) return;
    Voice.unlock();
    const saved = jget('ok_omiai', null);
    if (saved && saved.partnerId === S.partner.id && saved.history && saved.history.length > 1 && confirm('前回の続きから始めますか？')) {
      S.omiai = saved;
    } else {
      S.omiai = { partnerId: S.partner.id, history: [], affinity: 50, turns: 0, startedAt: Date.now() };
    }
    S.omiai.live = true;
    await enterRoom();
  });
  $('#talkSend').addEventListener('click', () => { Voice.unlock(); sendTalk($('#talkInput').value); });
  $('#talkInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendTalk($('#talkInput').value); }
  });
  $('#talkMic').addEventListener('click', () => {
    Voice.unlock();
    if (Mic.active()) { Mic.stop(); return; }
    Voice.stop();
    startTalkMic();
  });
  $('#btnLeave').addEventListener('click', () => {
    Mic.abort(); Voice.stop();
    S.avatarLoadToken = (S.avatarLoadToken || 0) + 1;
    setPhotoStatus('');
    if (S.omiai) { S.omiai.live = false; saveOmiai(); }
    $('#omiaiRoom').hidden = true;
    $('#omiaiSetup').hidden = false;
    renderPartnerCard();
    toast('中断しました。「お見合いを始める」から続きができます');
  });
  $('#btnFinish').addEventListener('click', async () => {
    if (!S.omiai) return;
    if (S.omiai.turns < 3 && !confirm('まだ会話が少ないですが、終えて結果を見ますか？')) return;
    Mic.abort(); Voice.stop();
    let result = null;
    const ok = await run('お見合いをふり返っています（30秒ほどかかります）', async () => {
      const j = await api('finishOmiai', {
        partner: S.partner, history: S.omiai.history, affinity: S.omiai.affinity,
        turns: S.omiai.turns, area: $('#optArea').value, mode: S.mode
      });
      result = j.result;
      if (j.user) { S.user = j.user; jset('ok_user', j.user); markProgress(); }
    });
    if (!ok || !result) return;
    S.lastResult = Object.assign({}, result, { partnerName: S.partner.name, date: new Date().toISOString() });
    S.omiai = null;
    jset('ok_omiai', null);
    S.logs = null;
    openResult();
  });
}

/* ---------- 結果 ---------- */
async function openResult() {
  show('result');
  renderResult(S.lastResult);
  if (!S.logs) {
    try { const j = await api('listLogs'); S.logs = j.logs || []; } catch (e) { S.logs = []; }
    if (!S.lastResult && S.logs.length) { S.lastResult = S.logs[0].result; renderResult(S.lastResult); }
  }
  renderLogs();
}
function renderResult(r) {
  const out = $('#resultOut');
  if (!r) {
    out.innerHTML = '<div class="panel empty"><p>まだ結果がありません。模擬お見合いを終えると、ここにふり返りと提案が出ます。</p><button type="button" class="btn" data-go="omiai">模擬お見合いへ</button></div>';
    return;
  }
  const li = arr => (arr || []).map(x => '<li>' + esc(x) + '</li>').join('');
  out.innerHTML =
    '<section class="panel verdict">' +
      '<div class="score"><b>' + esc(Math.round(Number(r.score) || 0)) + '</b><span>点</span></div>' +
      '<div><p class="verdict-label">' + esc(r.partnerName) + 'さんのお返事<strong>' + esc(r.verdict) + '</strong></p>' +
      '<blockquote>' + esc(r.partnerComment) + '</blockquote></div>' +
    '</section>' +
    '<section class="panel two">' +
      '<div><h3>よかったところ</h3><ul>' + li(r.goodPoints) + '</ul></div>' +
      '<div><h3>次に直したいところ</h3><ul>' + li(r.improvePoints) + '</ul></div>' +
    '</section>' +
    '<section class="panel"><h3 class="sec-title">お見合いで使える会話 10選</h3><ol class="talk-list">' +
      (r.conversations || []).map(c =>
        '<li><p class="sit">' + esc(c.situation) + '</p>' +
        '<p class="line">「' + esc(c.example) + '」</p>' +
        (c.followUp ? '<p class="follow">返ってきたら：' + esc(c.followUp) + '</p>' : '') +
        '<p class="why">' + esc(c.why) + '</p></li>').join('') +
    '</ol></section>' +
    '<section class="panel"><h3 class="sec-title">おすすめデートコース 10選</h3><div class="dates">' +
      (r.dates || []).map(d =>
        '<article class="date"><header><h4>' + esc(d.title) + '</h4><span class="cost">約' + yen(d.costYen) + '<small>／2人</small></span></header>' +
        '<p class="place">' + esc(d.place) + (d.stage ? '（' + esc(d.stage) + '）' : '') + '</p>' +
        '<ol class="flow">' + li(d.flow) + '</ol>' +
        '<p>' + esc(d.feature) + '</p>' +
        (d.costNote ? '<p class="muted small">' + esc(d.costNote) + '</p>' : '') +
        '</article>').join('') +
    '</div></section>' +
    '<div class="row center"><button type="button" class="btn" data-go="omiai">もう一度お見合いする</button><button type="button" class="btn ghost" data-go="styling">身だしなみを相談する</button></div>';
}
function renderLogs() {
  const ul = $('#logList');
  const logs = S.logs || [];
  if (!logs.length) { ul.innerHTML = '<li class="muted">まだ記録がありません。</li>'; return; }
  ul.innerHTML = logs.map((l, i) =>
    '<li><button type="button" data-log="' + i + '"><span>' + esc(l.partnerName) + 'さん・' + esc(l.verdict) + '・' + esc(l.score) + '点</span><span>' +
    esc(new Date(l.date).toLocaleDateString('ja-JP')) + '</span></button></li>').join('');
  $$('[data-log]', ul).forEach(b => b.addEventListener('click', () => {
    S.lastResult = logs[Number(b.dataset.log)].result;
    renderResult(S.lastResult);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

/* ---------- 設定の保存 ---------- */
function restoreOptions() {
  const o = jget('ok_opts', {});
  ['optWait', 'optVoice', 'optDifficulty'].forEach(id => { if (o[id] != null && $('#' + id)) $('#' + id).value = o[id]; });
  ['optHandsFree', 'optInner', 'hearSpeak'].forEach(id => { if (o[id] != null && $('#' + id)) $('#' + id).checked = !!o[id]; });
  ['optWait', 'optVoice', 'optDifficulty', 'optHandsFree', 'optInner', 'hearSpeak'].forEach(id => {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener('change', () => {
      const cur = jget('ok_opts', {});
      cur[id] = el.type === 'checkbox' ? el.checked : el.value;
      jset('ok_opts', cur);
    });
  });
}

/* ---------- 起動 ---------- */
function init() {
  renderVersion();
  renderChangelog();
  $('#verBadge').addEventListener('click', openVersion);
  $('#ver').addEventListener('click', openVersion);
  checkServer();
  avatar = new Avatar($('#avatar'));
  $$('[data-mode-btn]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.modeBtn)));
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); }
  });
  bindAuth();
  bindHearing();
  bindStyling();
  bindOmiai();
  restoreOptions();
  setMode(S.mode, true);
  $$('input[name=rgGender]').forEach(r => { r.checked = r.value === S.mode; });
  if (!Mic.supported()) $('#hearMic').title = 'このブラウザは音声入力に対応していません';
  if (S.token && S.user) enter(); else show('auth');
}
init();
