/**
 * =========================================================
 * お見合い稽古（omiai-keiko）— 婚活シミュレーション＆トレーニング
 * Google Apps Script バックエンド  v1.0.2
 * =========================================================
 * スクリプトプロパティ
 *   GEMINI_API_KEY   (必須) Gemini APIキー
 *   GEMINI_MODEL     (任意) 会話・分析用モデル   既定: gemini-2.5-flash
 *   GEMINI_TTS_MODEL (任意) 音声合成モデル       既定: gemini-3.8-flash-tts
 *   APP_URL          (任意) メールに載せる公開URL 既定: https://kenken6291.github.io/omiai-keiko/
 *   AVATAR_FOLDER_ID (任意) お相手画像の親フォルダID（Drive）
 *   SPREADSHEET_ID   (任意) スタンドアロンのスクリプトで使う場合のみ
 *   PEPPER           setup() が自動で作成
 *
 * お相手の写真（任意）
 *   AVATAR_FOLDER_ID の中に、お相手ごとのフォルダを作る。
 *   フォルダ名は female_ / male_（または 女性_ / 男性_）で始める。例: female_30s_01
 *   年代は「30s」「30代」をフォルダ名に入れると年齢の目安になる。
 *   画像ファイル名はどちらの形式でもよい：
 *     日本語: 01_普通の顔.jpg / 01_普通の顔_瞬き.jpg / 01_普通の顔_しゃべり.jpg
 *             笑顔・驚き顔・困り顔 も同じ（頭の番号は自由）
 *     英語  : normal_base.png / smile_blink.png / surprise_talk.png など
 *   「普通の顔」だけは必須。無い表情は普通の顔で代用。
 *   すべて同じサイズ・同じ顔位置で書き出すこと（ズレ防止）。
 *   フォルダ内に「設定.txt」（または profile.txt / .md / .json）を置くと、
 *   名前・年齢・職業・人柄などをその内容に固定できる。
 * =========================================================
 */

const APP_VERSION = '1.0.2';
const APP_NAME = 'お見合い稽古';
const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash';
const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts';
const DEFAULT_APP_URL = 'https://kenken6291.github.io/omiai-keiko/';
const SESSION_TTL = 21600; // 6時間
const MAX_FAIL = 5;
const LOCK_MIN = 15;

const SHEET = { USERS: 'Users', PROFILES: 'Profiles', PARTNERS: 'Partners', LOGS: 'Logs' };
const USER_COLS = ['userId', 'email', 'nickname', 'salt', 'hash', 'gender', 'ageGroup', 'progress',
  'mustChange', 'failCount', 'lockedUntil', 'createdAt', 'updatedAt'];
const LOG_COLS = ['logId', 'userId', 'partnerName', 'turns', 'affinity', 'score', 'verdict', 'logJson', 'resultJson', 'createdAt'];

const VOICES_F = ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Autonoe', 'Callirrhoe', 'Despina', 'Erinome',
  'Laomedeia', 'Achernar', 'Gacrux', 'Pulcherrima', 'Sulafat', 'Vindemiatrix'];
const VOICES_M = ['Puck', 'Charon', 'Fenrir', 'Orus', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Algenib', 'Rasalgethi', 'Alnilam', 'Schedar', 'Achird', 'Zubenelgenubi', 'Sadachbia', 'Sadaltager'];
const EXPRS = ['normal', 'smile', 'surprise', 'trouble'];

/* =========================================================
 * 初期設定（エディタから1回実行）
 * ========================================================= */
function setup() {
  const ss = ss_();
  const defs = {};
  defs[SHEET.USERS] = USER_COLS;
  defs[SHEET.PROFILES] = ['userId', 'profileJson', 'updatedAt'];
  defs[SHEET.PARTNERS] = ['userId', 'partnerJson', 'updatedAt'];
  defs[SHEET.LOGS] = LOG_COLS;
  Object.keys(defs).forEach(function (n) {
    let s = ss.getSheetByName(n);
    if (!s) s = ss.insertSheet(n);
    if (s.getLastRow() === 0) { s.appendRow(defs[n]); s.setFrozenRows(1); }
  });
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('PEPPER')) p.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());
  Logger.log('setup 完了。GEMINI_API_KEY をスクリプトプロパティに設定してください。');
}

/** 権限の承認用（メール・Drive・外部通信） */
function authorize() {
  MailApp.getRemainingDailyQuota();
  DriveApp.getRootFolder();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  Logger.log('承認OK');
}

/* =========================================================
 * ルーティング
 * ========================================================= */
function doGet() {
  return json_({ ok: true, app: APP_NAME, version: APP_VERSION });
}

function doPost(e) {
  let res;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const a = String(req.action || '');
    const PUBLIC = {
      ping: function () { return {}; },
      register: api_register_,
      login: api_login_,
      resetPassword: api_resetPassword_
    };
    const PRIVATE = {
      validate: function (r, u) { return { user: publicUser_(u) }; },
      logout: api_logout_,
      changePassword: api_changePassword_,
      updateAccount: api_updateAccount_,
      getProfile: api_getProfile_,
      structureProfile: api_structureProfile_,
      createPartner: api_createPartner_,
      listAvatars: api_listAvatars_,
      getAvatar: api_getAvatar_,
      omiaiChat: api_omiaiChat_,
      tts: api_tts_,
      advice: api_advice_,
      finishOmiai: api_finishOmiai_,
      listLogs: api_listLogs_
    };
    if (PUBLIC[a]) {
      res = PUBLIC[a](req);
    } else if (PRIVATE[a]) {
      const user = auth_(req.token);
      if (truthy_(user.mustChange) && ['changePassword', 'validate', 'logout'].indexOf(a) < 0) {
        throw new Error('先に新しいパスワードを設定してください');
      }
      res = PRIVATE[a](req, user);
    } else {
      throw new Error('不明な操作です: ' + a);
    }
    res = Object.assign({ ok: true, version: APP_VERSION }, res || {});
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err), version: APP_VERSION };
  }
  return json_(res);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================
 * 共通
 * ========================================================= */
function prop_(k, d) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  return v ? v : d;
}
function ss_() {
  const id = prop_('SPREADSHEET_ID', '');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sh_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('シート「' + name + '」がありません。setup() を実行してください');
  return s;
}
function truthy_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function str_(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }
function genderJa_(g) { return g === 'female' ? '女性' : '男性'; }
function clampNum_(v, a, b, d) { const n = Number(v); return isNaN(n) ? d : Math.max(a, Math.min(b, n)); }

/* ---------- ユーザー ---------- */
function findUser_(key, val) {
  const s = sh_(SHEET.USERS);
  const last = s.getLastRow();
  if (last < 2) return null;
  const v = s.getRange(2, 1, last - 1, USER_COLS.length).getValues();
  const ci = USER_COLS.indexOf(key);
  const target = String(val).toLowerCase();
  for (let i = 0; i < v.length; i++) {
    if (String(v[i][ci]).toLowerCase() === target) {
      const o = { _row: i + 2 };
      USER_COLS.forEach(function (c, j) { o[c] = v[i][j]; });
      return o;
    }
  }
  return null;
}
function saveUser_(u) {
  const s = sh_(SHEET.USERS);
  u.updatedAt = new Date();
  const row = USER_COLS.map(function (c) { return u[c] === undefined ? '' : u[c]; });
  if (u._row) s.getRange(u._row, 1, 1, row.length).setValues([row]);
  else { s.appendRow(row); u._row = s.getLastRow(); }
  return u;
}
function publicUser_(u) {
  return {
    userId: u.userId, email: u.email, nickname: u.nickname, gender: u.gender,
    ageGroup: u.ageGroup, progress: Number(u.progress || 0), mustChange: truthy_(u.mustChange)
  };
}
function setProgress_(u, n) {
  if (n > Number(u.progress || 0)) { u.progress = n; saveUser_(u); }
}
function hash_(pw, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    String(salt) + String(pw) + prop_('PEPPER', ''), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function tempPassword_() {
  const cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += cs.charAt(Math.floor(Math.random() * cs.length));
  return s.replace(/^(.{8})/, '$1') + (/\d/.test(s) ? '' : '7');
}
function sendTempMail_(to, nick, temp, kind) {
  const url = prop_('APP_URL', DEFAULT_APP_URL);
  const body = nick + ' さん\n\n' +
    APP_NAME + 'の' + kind + 'を受け付けました。\n\n' +
    '仮パスワード：' + temp + '\n\n' +
    '次のページでメールアドレスと仮パスワードを入力してログインし、新しいパスワードを設定してください。\n' +
    url + '\n\n' +
    'このメールに心当たりがない場合は、破棄してください。\n';
  MailApp.sendEmail({ to: to, subject: '【' + APP_NAME + '】仮パスワードのお知らせ', body: body, name: APP_NAME });
}

/* ---------- セッション ---------- */
function auth_(token) {
  if (!token) throw new Error('SESSION_EXPIRED');
  const c = CacheService.getScriptCache();
  const id = c.get('s_' + token);
  if (!id) throw new Error('SESSION_EXPIRED');
  c.put('s_' + token, id, SESSION_TTL);
  const u = findUser_('userId', id);
  if (!u) throw new Error('SESSION_EXPIRED');
  return u;
}

/* ---------- JSON保存（ユーザーごと1行） ---------- */
function upsertJson_(name, userId, obj) {
  const s = sh_(name);
  const last = s.getLastRow();
  const str = JSON.stringify(obj);
  if (last >= 2) {
    const ids = s.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === userId) { s.getRange(i + 2, 2, 1, 2).setValues([[str, new Date()]]); return; }
    }
  }
  s.appendRow([userId, str, new Date()]);
}
function getJson_(name, userId) {
  const s = sh_(name);
  const last = s.getLastRow();
  if (last < 2) return null;
  const v = s.getRange(2, 1, last - 1, 2).getValues();
  for (let i = 0; i < v.length; i++) {
    if (v[i][0] === userId) { try { return JSON.parse(v[i][1]); } catch (e) { return null; } }
  }
  return null;
}

/* =========================================================
 * 会員認証API
 * ========================================================= */
function api_register_(req) {
  const email = str_(req.email, 200).toLowerCase();
  const nickname = str_(req.nickname, 20);
  const gender = req.gender === 'female' ? 'female' : 'male';
  const ageGroup = str_(req.ageGroup, 10);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('メールアドレスの形式が正しくありません');
  if (!nickname) throw new Error('ニックネームを入力してください');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (findUser_('email', email)) throw new Error('このメールアドレスは登録済みです。ログインするか、パスワード再発行を使ってください');
    const temp = tempPassword_();
    const salt = Utilities.getUuid();
    const u = {
      userId: 'U' + Utilities.getUuid().replace(/-/g, '').slice(0, 12),
      email: email, nickname: nickname, salt: salt, hash: hash_(temp, salt),
      gender: gender, ageGroup: ageGroup, progress: 0, mustChange: true,
      failCount: 0, lockedUntil: '', createdAt: new Date()
    };
    saveUser_(u);
    sendTempMail_(email, nickname, temp, '会員登録');
  } finally {
    lock.releaseLock();
  }
  return { message: '仮パスワードをメールで送りました。メールを確認してログインしてください' };
}

function api_login_(req) {
  const email = str_(req.email, 200).toLowerCase();
  const pw = String(req.password || '');
  const u = findUser_('email', email);
  if (!u) throw new Error('メールアドレスかパスワードが違います');
  const now = new Date();
  if (u.lockedUntil && new Date(u.lockedUntil) > now) {
    const m = Math.ceil((new Date(u.lockedUntil) - now) / 60000);
    throw new Error('ログインに' + MAX_FAIL + '回失敗したため、あと' + m + '分ロックされています。パスワード再発行で解除できます');
  }
  if (hash_(pw, u.salt) !== u.hash) {
    u.failCount = Number(u.failCount || 0) + 1;
    let msg = 'メールアドレスかパスワードが違います（あと' + (MAX_FAIL - u.failCount) + '回でロック）';
    if (u.failCount >= MAX_FAIL) {
      u.failCount = 0;
      u.lockedUntil = new Date(now.getTime() + LOCK_MIN * 60000);
      msg = 'ログインに' + MAX_FAIL + '回失敗したため、' + LOCK_MIN + '分間ロックしました';
    }
    saveUser_(u);
    throw new Error(msg);
  }
  u.failCount = 0;
  u.lockedUntil = '';
  saveUser_(u);
  const token = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  CacheService.getScriptCache().put('s_' + token, u.userId, SESSION_TTL);
  return { token: token, user: publicUser_(u) };
}

function api_logout_(req) {
  if (req.token) CacheService.getScriptCache().remove('s_' + req.token);
  return {};
}

function api_changePassword_(req, u) {
  const cur = String(req.currentPassword || '');
  const np = String(req.newPassword || '');
  if (hash_(cur, u.salt) !== u.hash) throw new Error('今のパスワードが違います');
  if (np.length < 8 || !/[A-Za-z]/.test(np) || !/\d/.test(np)) throw new Error('新しいパスワードは英字と数字を含む8文字以上にしてください');
  if (np === cur) throw new Error('今のパスワードとは違うものにしてください');
  u.salt = Utilities.getUuid();
  u.hash = hash_(np, u.salt);
  u.mustChange = false;
  saveUser_(u);
  return { user: publicUser_(u) };
}

function api_resetPassword_(req) {
  const email = str_(req.email, 200).toLowerCase();
  const msg = { message: '登録があれば、仮パスワードをメールで送りました。メールを確認してください' };
  const u = findUser_('email', email);
  if (!u) return msg;
  const temp = tempPassword_();
  u.salt = Utilities.getUuid();
  u.hash = hash_(temp, u.salt);
  u.mustChange = true;
  u.failCount = 0;
  u.lockedUntil = '';
  saveUser_(u);
  sendTempMail_(email, u.nickname, temp, 'パスワード再発行');
  return msg;
}

function api_updateAccount_(req, u) {
  if (req.nickname) u.nickname = str_(req.nickname, 20);
  if (req.gender) u.gender = req.gender === 'female' ? 'female' : 'male';
  if (req.ageGroup) u.ageGroup = str_(req.ageGroup, 10);
  saveUser_(u);
  return { user: publicUser_(u) };
}

/* =========================================================
 * Gemini
 * ========================================================= */
function callGemini_(model, body) {
  const key = prop_('GEMINI_API_KEY', '');
  if (!key) throw new Error('GEMINI_API_KEY が設定されていません');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key;
  let last = '';
  for (let i = 0; i < 3; i++) {
    const r = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    const code = r.getResponseCode();
    if (code === 200) return JSON.parse(r.getContentText());
    last = code + ' ' + r.getContentText().slice(0, 300);
    if (code === 429 || code >= 500) { Utilities.sleep(1200 * (i + 1)); continue; }
    break;
  }
  throw new Error('AIの呼び出しに失敗しました（' + last + '）');
}

function gemini_(prompt, opt) {
  opt = opt || {};
  const body = {
    contents: opt.contents || [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: opt.temperature == null ? 0.8 : opt.temperature }
  };
  if (opt.system) body.systemInstruction = { parts: [{ text: opt.system }] };
  if (opt.json) body.generationConfig.responseMimeType = 'application/json';
  const j = callGemini_(prop_('GEMINI_MODEL', DEFAULT_TEXT_MODEL), body);
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  const text = parts.map(function (p) { return p.text || ''; }).join('');
  if (!text) throw new Error('AIから返事がありませんでした。もう一度試してください');
  return opt.json ? parseJson_(text) : text;
}

function parseJson_(t) {
  const s = String(t).replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch (e) {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
  }
  throw new Error('AIの返事を読み取れませんでした。もう一度試してください');
}

/* =========================================================
 * プロフィール（音声ヒアリング → 構造化）
 * ========================================================= */
function api_getProfile_(req, u) {
  return {
    user: publicUser_(u),
    profile: getJson_(SHEET.PROFILES, u.userId),
    partner: getJson_(SHEET.PARTNERS, u.userId)
  };
}

function api_structureProfile_(req, u) {
  const answers = (req.answers || []).slice(0, 20).map(function (x) {
    return 'Q（' + str_(x.cat, 20) + '）' + str_(x.q, 200) + '\nA：' + (str_(x.a, 1500) || '（回答なし）');
  }).join('\n\n');
  const mode = req.mode === 'female' ? 'female' : (req.mode === 'male' ? 'male' : u.gender);
  const schema = {
    self: { personality: '性格（60字程度）', hobbies: ['趣味'], lifestyle: '生活習慣（60字程度）' },
    wants: { mustConditions: ['譲れない条件'], flexiblePoints: ['気にしない点'], marriageView: '結婚観（80字程度）' },
    type: { preferredType: '好みのタイプ（60字程度）', ageRange: '例: 30代前半', ageMin: 0, ageMax: 0 },
    worries: '婚活の不安',
    appealPoints: ['アピールポイントを3つ'],
    selfIntro: 'お見合いで使える自己紹介（一人称・150字程度）',
    counselorComment: 'カウンセラーとしてのひとこと（100字程度、前向きで具体的に）'
  };
  const prompt = [
    'あなたは結婚相談所のベテランカウンセラーです。',
    '以下は会員（' + genderJa_(mode) + '・' + u.ageGroup + '）への音声ヒアリングの書き起こしです。',
    '言い間違いやフィラー（えーと等）は補正し、内容を次のJSONの形にまとめてください。',
    '分からない項目は空文字か空配列にし、事実を作らないこと。年齢の数値は分かる範囲で入れ、不明なら0。',
    'JSONのみを出力：',
    JSON.stringify(schema),
    '',
    '書き起こし：',
    answers
  ].join('\n');
  const p = gemini_(prompt, { json: true, temperature: 0.4 });
  p.updatedAt = new Date().toISOString();
  upsertJson_(SHEET.PROFILES, u.userId, p);
  setProgress_(u, 1);
  return { profile: p, user: publicUser_(u) };
}

/* =========================================================
 * お見合い相手の生成
 * ========================================================= */
function api_createPartner_(req, u) {
  const mode = req.mode === 'female' ? 'female' : 'male';
  const difficulty = ['やさしい', 'ふつう', '手ごわい'].indexOf(req.difficulty) >= 0 ? req.difficulty : 'ふつう';
  const profile = getJson_(SHEET.PROFILES, u.userId) || {};
  const ageRange = (profile.type && profile.type.ageRange) || '';
  const defaultGender = mode === 'male' ? 'female' : 'male';

  // 写真の選択
  const choice = String(req.avatarChoice || 'auto');
  const folders = avatarFolders_();
  let folder = null, chosen = false;
  if (choice === 'auto') {
    const list = folders.filter(function (f) { return f.gender === defaultGender; });
    if (list.length) folder = list[Math.floor(Math.random() * list.length)];
  } else if (choice !== 'illust') {
    folder = folders.filter(function (f) { return f.id === choice; })[0] || null;
    if (!folder) throw new Error('選んだ写真が見つかりません。「写真を読み直す」を押してください');
    chosen = true;
  }
  const pg = folder && folder.gender ? folder.gender : defaultGender;
  const voices = pg === 'female' ? VOICES_F : VOICES_M;
  const settings = folder ? folderSettings_(folder.id) : '';

  // 会員が指定した項目
  const c = req.custom || {};
  const custom = {
    name: str_(c.name, 20), age: str_(c.age, 3), job: str_(c.job, 30),
    hobby: str_(c.hobby, 60), note: str_(c.note, 300)
  };
  const customLines = [];
  if (custom.name) customLines.push('名前：' + custom.name);
  if (custom.age) customLines.push('年齢：' + custom.age + '歳');
  if (custom.job) customLines.push('職業：' + custom.job);
  if (custom.hobby) customLines.push('趣味：' + custom.hobby);
  if (custom.note) customLines.push('人柄・話し方：' + custom.note);

  let ageRule = 'お相手の年齢：会員の希望年齢（' + (ageRange || '指定なし') + '）の範囲内。指定がなければ会員と近い年代。';
  if (custom.age) ageRule = 'お相手の年齢：' + custom.age + '歳';
  else if (folder && folder.ageHint) ageRule = 'お相手の年齢：' + folder.ageHint + '（写真の人の年代）';

  const schema = {
    name: '氏名（漢字・フルネーム・架空）', kana: 'ふりがな', age: 0, gender: pg,
    job: '職業', residence: '住まい（都道府県・市まで）',
    personality: '人柄（60字程度）', hobbies: ['趣味'],
    values: '結婚で大切にしていること（60字程度）',
    appearance: '見た目の印象（40字程度）',
    likes: ['好感を持つ相手の言動'], dislikes: ['苦手な相手の言動'],
    speechStyle: '口調（例：丁寧語、少し関西なまり 等）',
    firstLine: '最初のあいさつ（40字以内）',
    voiceName: '声の候補から1つ', voiceStyle: '音声合成への話し方の指示（例：落ち着いた明るいトーンで、少しゆっくり）',
    pitch: 1.0, rate: 1.0
  };
  const prompt = [
    'あなたは結婚相談所の模擬お見合い用に、架空のお見合い相手を1人作ります。実在の人物名は使わないでください。',
    '会員：' + genderJa_(mode) + '・' + u.ageGroup + '・ニックネーム ' + u.nickname,
    '会員のプロフィール：' + JSON.stringify(profile),
    'お相手の性別：' + genderJa_(pg),
    ageRule,
    '話しやすさ：' + difficulty + '（やさしい＝話しやすく好意的／ふつう＝一般的／手ごわい＝慎重で人見知り、価値観にこだわりがある）',
    settings ? '【写真の人の固定設定（書かれている項目はそのまま使う）】\n' + settings : '',
    customLines.length ? '【会員の指定（必ずこのとおりにする。固定設定より優先）】\n' + customLines.join('\n') : '',
    '指定のない項目は、会員の趣味や結婚観と少し重なり少し違うくらいの人物にすること。',
    '声の候補（必ずこの中から1つ）：' + voices.join(', '),
    'pitch は 0.8〜1.2、rate は 0.85〜1.15 の範囲（端末の声で使う）。',
    'JSONのみを出力：',
    JSON.stringify(schema)
  ].filter(function (x) { return x; }).join('\n');

  const p = gemini_(prompt, { json: true, temperature: 1.0 });
  p.id = Utilities.getUuid();
  p.gender = pg;
  p.difficulty = difficulty;
  if (custom.name) p.name = custom.name;
  p.age = Math.round(clampNum_(custom.age || p.age, 18, 90, 35));
  if (custom.job) p.job = custom.job;
  p.hobbies = Array.isArray(p.hobbies) ? p.hobbies.slice(0, 6) : [];
  if (voices.indexOf(p.voiceName) < 0) p.voiceName = voices[Math.floor(Math.random() * voices.length)];
  p.pitch = clampNum_(p.pitch, 0.8, 1.2, 1);
  p.rate = clampNum_(p.rate, 0.85, 1.15, 1);
  p.avatarFolderId = folder ? folder.id : '';
  p.photoChosen = chosen;
  p.createdAt = new Date().toISOString();
  upsertJson_(SHEET.PARTNERS, u.userId, p);
  return { partner: p };
}

/* ---------- お相手の写真（Drive） ---------- */
function avatarKey_(fileName) {
  const base = String(fileName).replace(/\.(png|jpe?g|webp)$/i, '');
  if (base === fileName) return null;
  const en = base.match(/^(normal|smile|surprise|trouble)_(base|blink|talk)$/i);
  if (en) return en[1].toLowerCase() + '_' + en[2].toLowerCase();
  let expr = null;
  if (/普通|ふつう|通常|真顔|normal/i.test(base)) expr = 'normal';
  else if (/笑|smile/i.test(base)) expr = 'smile';
  else if (/驚|おどろ|surprise/i.test(base)) expr = 'surprise';
  else if (/困|こまり|trouble/i.test(base)) expr = 'trouble';
  if (!expr) return null;
  let st = 'base';
  if (/瞬き|まばたき|目閉じ|blink/i.test(base)) st = 'blink';
  else if (/しゃべ|喋|話し|口パク|talk/i.test(base)) st = 'talk';
  return expr + '_' + st;
}
function folderMeta_(f) {
  const name = f.getName();
  let gender = '';
  if (/^(female|女性|女)/i.test(name)) gender = 'female';
  else if (/^(male|男性|男)/i.test(name)) gender = 'male';
  const m = name.match(/(\d0)\s*(s|代)/i);
  return { id: f.getId(), name: name, title: name.replace(/^(female|male|女性|男性)[_\-\s]*/i, '') || name, gender: gender, ageHint: m ? m[1] + '代' : '' };
}
function avatarFolders_() {
  const root = prop_('AVATAR_FOLDER_ID', '');
  if (!root) return [];
  const out = [];
  try {
    const it = DriveApp.getFolderById(root).getFolders();
    while (it.hasNext()) out.push(folderMeta_(it.next()));
  } catch (e) { return []; }
  out.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
  return out;
}
function avatarFiles_(folderId) {
  const map = {};
  const it = DriveApp.getFolderById(folderId).getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const k = avatarKey_(f.getName());
    if (k && !map[k]) map[k] = f;
  }
  return map;
}
function folderSettings_(folderId) {
  try {
    const it = DriveApp.getFolderById(folderId).getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (/^(設定|profile|プロフィール)/i.test(f.getName()) && /\.(txt|md|json)$/i.test(f.getName())) {
        return f.getBlob().getDataAsString('UTF-8').slice(0, 2000);
      }
    }
  } catch (e) {}
  return '';
}
function api_listAvatars_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('avatar_list_v2');
  if (hit) return { avatars: JSON.parse(hit) };
  const out = avatarFolders_().map(function (f) {
    let thumb = '';
    try {
      const file = avatarFiles_(f.id).normal_base;
      if (file) {
        const tb = file.getThumbnail();
        if (tb) thumb = 'data:' + (tb.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(tb.getBytes());
      }
    } catch (e) {}
    f.thumb = thumb;
    return f;
  });
  try { cache.put('avatar_list_v2', JSON.stringify(out), 600); } catch (e) {}
  return { avatars: out };
}
function api_getAvatar_(req) {
  const id = String(req.folderId || '');
  if (!avatarFolders_().some(function (f) { return f.id === id; })) throw new Error('お相手の写真が見つかりません');
  const files = avatarFiles_(id);
  const keys = Object.keys(files);
  if (!files.normal_base) throw new Error('「普通の顔」の写真がありません');

  // 表示用に縮小した画像を並列で取得（失敗したものは元画像）
  const token = ScriptApp.getOAuthToken();
  const reqs = keys.map(function (k) {
    return { url: 'https://drive.google.com/thumbnail?sz=w720&id=' + files[k].getId(), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true, followRedirects: true };
  });
  let res = [];
  try { res = UrlFetchApp.fetchAll(reqs); } catch (e) { res = []; }
  const images = {};
  keys.forEach(function (k, i) {
    const r = res[i];
    if (r && r.getResponseCode() === 200) {
      const b = r.getBlob();
      const ct = b.getContentType() || '';
      const bytes = b.getBytes();
      if (/^image\//.test(ct) && bytes.length > 3000) {
        images[k] = 'data:' + ct + ';base64,' + Utilities.base64Encode(bytes);
        return;
      }
    }
    const blob = files[k].getBlob();
    images[k] = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  });
  return { images: images };
}

/* =========================================================
 * 模擬お見合い（会話）
 * ========================================================= */
function api_omiaiChat_(req, u) {
  const p = req.partner || {};
  const msg = str_(req.message, 600);
  if (!msg) throw new Error('話しかける言葉を入力してください');
  const mode = req.mode === 'female' ? 'female' : 'male';
  const affinity = clampNum_(req.affinity, 0, 100, 50);
  const turns = clampNum_(req.turns, 0, 999, 0);

  const persona = {
    name: p.name, age: p.age, job: p.job, residence: p.residence, personality: p.personality,
    hobbies: p.hobbies, values: p.values, likes: p.likes, dislikes: p.dislikes, speechStyle: p.speechStyle
  };
  const system = [
    'あなたは結婚相談所のお見合いに来た「' + str_(p.name, 30) + '」を演じます。場所はホテルのラウンジで、初対面です。',
    '目の前の相手は ' + u.nickname + ' さん（' + genderJa_(mode) + '・' + u.ageGroup + '）。',
    'あなたの人物設定：' + JSON.stringify(persona),
    '話しやすさ：' + str_(p.difficulty || 'ふつう', 10),
    '現在の好感度：' + affinity + '／100、会話の往復：' + turns + '回目',
    '',
    'ルール：',
    '・必ず日本語で、設定の口調で話す。1〜3文、全体で90字以内の自然な話し言葉。',
    '・AIであることや設定・好感度の数値を口にしない。',
    '・本物のお見合い相手として本音で反応する。共感、相手の話への具体的な質問や深掘り、感じのよい自己開示、笑顔が伝わる言葉には好感度アップ。',
    '・自分の話ばかり、質問攻め、年収や家柄など条件の詮索、否定的な発言、なれなれしい言葉づかい、元恋人の話には好感度ダウン。',
    '・相手から質問されたら答え、ときどき質問を返す。会話が途切れたら自分から話題を出す。',
    '・好感度が低いときは少しそっけなく、高いときは打ち解けた雰囲気にする。',
    '',
    '出力はJSONのみ：',
    '{"reply":"お相手のセリフ","expression":"normal|smile|surprise|trouble のどれか","affinityDelta":-10〜10の整数,' +
    '"innerVoice":"お相手の心の声（30字以内）","hint":"会員への次の一手の助言（40字以内）"}'
  ].join('\n');

  const contents = [{ role: 'user', parts: [{ text: '（ラウンジで向かい合って席に着きました。あいさつをどうぞ）' }] }];
  (req.history || []).slice(-40).forEach(function (h) {
    const role = h.role === 'partner' ? 'model' : 'user';
    const text = str_(h.text, 600);
    if (!text) return;
    const lastC = contents[contents.length - 1];
    if (lastC.role === role) lastC.parts[0].text += '\n' + text;
    else contents.push({ role: role, parts: [{ text: text }] });
  });
  const lastC = contents[contents.length - 1];
  if (lastC.role === 'user') lastC.parts[0].text += '\n' + msg;
  else contents.push({ role: 'user', parts: [{ text: msg }] });

  const r = gemini_('', { contents: contents, system: system, json: true, temperature: 0.9 });
  const result = {
    reply: str_(r.reply, 300) || 'そうなんですね。',
    expression: EXPRS.indexOf(r.expression) >= 0 ? r.expression : 'normal',
    affinityDelta: Math.round(clampNum_(r.affinityDelta, -10, 10, 0)),
    innerVoice: str_(r.innerVoice, 60),
    hint: str_(r.hint, 80)
  };
  return { result: result };
}

/* ---------- Gemini TTS ---------- */
function api_tts_(req) {
  const text = str_(req.text, 400);
  if (!text) throw new Error('読み上げる文がありません');
  const all = VOICES_F.concat(VOICES_M);
  const voice = all.indexOf(req.voiceName) >= 0 ? req.voiceName : 'Kore';
  const style = str_(req.style, 120);
  const prompt = style ? style + '話してください：\n' + text : text;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  };
  const j = callGemini_(prop_('GEMINI_TTS_MODEL', DEFAULT_TTS_MODEL), body);
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  const hit = parts.filter(function (x) { return x.inlineData && x.inlineData.data; })[0];
  if (!hit) throw new Error('音声を作れませんでした');
  return { audio: hit.inlineData.data, mimeType: hit.inlineData.mimeType || 'audio/L16;rate=24000' };
}

/* =========================================================
 * 3大プロ アドバイス
 * ========================================================= */
function api_advice_(req, u) {
  const KIND = {
    stylist: {
      name: 'AIスタイリスト',
      focus: 'お見合い当日の服装コーディネート（男性はスーツ／ジャケパン、女性はワンピース／ブラウス＋スカートなど）。色合わせ、サイズ感、素材、季節感、靴・バッグ・小物、清潔感のチェックポイント。'
    },
    hair: {
      name: 'AIヘアリスト',
      focus: '顔の形・骨格・年代に合う髪型、美容院でのオーダーの伝え方、スタイリング剤の選び方、当日の整え方の手順、白髪・薄毛・うねりなど年代特有の悩みへの対処。'
    },
    makeup: {
      name: 'AIメイクリスト',
      focus: '女性はナチュラルメイク・肌トーン補正・眉・リップ・崩れ対策。男性は肌の保湿、眉の整え方、ひげ・鼻毛・爪・においのケア、必要ならBBクリームや色付きリップなどのメンズメイク。清潔感を上げる具体的な手順。'
    }
  };
  const k = KIND[req.kind] ? req.kind : 'stylist';
  const mode = req.mode === 'female' ? 'female' : 'male';
  const profile = getJson_(SHEET.PROFILES, u.userId) || {};
  const schema = {
    title: '提案のタイトル（20字程度）',
    summary: '全体の方針（100字程度）',
    sections: [{ heading: '見出し', points: ['具体的なポイント'] }],
    steps: ['当日の手順（順番どおり）'],
    checklist: ['出かける前のチェック項目'],
    ng: ['避けたいこと'],
    items: [{ name: 'アイテム', note: '選び方', price: '目安価格（円）' }]
  };
  const prompt = [
    'あなたは結婚相談所と提携する' + KIND[k].name + 'です。',
    '担当範囲：' + KIND[k].focus,
    '相談者：' + genderJa_(mode) + '・' + u.ageGroup,
    'お見合いの場所：' + str_(req.situation, 40) + '／季節：' + str_(req.season, 10),
    '顔の形：' + str_(req.faceShape, 40) + '／骨格タイプ：' + str_(req.bodyType, 60),
    '予算：' + str_(req.budget, 40),
    '気になっていること：' + (str_(req.concerns, 300) || 'なし'),
    '性格・生活の参考：' + JSON.stringify(profile.self || {}),
    '',
    '「わからない」の項目は、多くの人に合う無難な提案にしてください。',
    '一般的な大衆ブランド・量販店で手に入るものを中心に、具体的に。sections は3〜5個、steps は4〜8個、checklist は6〜10個、ng は3〜5個、items は3〜6個。',
    'JSONのみを出力：',
    JSON.stringify(schema)
  ].join('\n');
  const a = gemini_(prompt, { json: true, temperature: 0.7 });
  setProgress_(u, 2);
  return { advice: a, user: publicUser_(u) };
}

/* =========================================================
 * 終了 → ふり返り・会話10選・デート10選
 * ========================================================= */
function api_finishOmiai_(req, u) {
  const p = req.partner || {};
  const mode = req.mode === 'female' ? 'female' : 'male';
  const affinity = clampNum_(req.affinity, 0, 100, 50);
  const history = (req.history || []).slice(-80);
  if (history.length < 2) throw new Error('会話がまだありません');
  const transcript = history.map(function (h) {
    return (h.role === 'partner' ? p.name : 'あなた') + '：' + str_(h.text, 600);
  }).join('\n');
  const profile = getJson_(SHEET.PROFILES, u.userId) || {};
  const area = str_(req.area, 60);
  const schema = {
    score: 0,
    verdict: '交際希望／保留／お断り のどれか',
    partnerComment: 'お相手の立場からの率直な感想（120字程度、お相手の口調で）',
    goodPoints: ['よかったところ3つ'],
    improvePoints: ['直したいところ3つ（具体的な言い換え例を含める）'],
    conversations: [{ situation: '使う場面', example: '実際に言うセリフ', followUp: '相手が答えたあとの深掘り・切り返し', why: '効果の理由' }],
    dates: [{ title: 'コース名', stage: '仮交際／本交際初期', place: '場所の種類と地域', flow: ['流れ（3〜4つ）'], feature: 'このデートの良さ', costYen: 0, costNote: '費用の内訳' }]
  };
  const prompt = [
    'あなたは結婚相談所のベテランカウンセラーです。模擬お見合いをふり返ってください。',
    '会員：' + genderJa_(mode) + '・' + u.ageGroup + '・' + u.nickname + 'さん',
    '会員のプロフィール：' + JSON.stringify(profile),
    'お相手：' + JSON.stringify({ name: p.name, age: p.age, job: p.job, personality: p.personality, hobbies: p.hobbies, values: p.values, likes: p.likes, dislikes: p.dislikes }),
    '最終的な好感度：' + affinity + '／100',
    '会話の記録：',
    transcript,
    '',
    '指示：',
    '・score は会話の内容と好感度をもとに0〜100で採点。',
    '・conversations は必ず10個。お相手のプロフィールと今回の会話を踏まえ、盛り上がる質問、切り返し、深掘りの具体例にする。',
    '・dates は必ず10個。仮交際〜本交際初期を想定し、costYen は2人分の概算（円・整数）。',
    '・デートの地域：' + (area || '指定なし（どの地域でも成り立つ一般的なプランにする）'),
    '・お相手の趣味や好みを活かしたプランを半分以上入れる。',
    'JSONのみを出力：',
    JSON.stringify(schema)
  ].join('\n');
  const r = gemini_(prompt, { json: true, temperature: 0.8 });
  r.score = Math.round(clampNum_(r.score, 0, 100, affinity));
  r.conversations = (r.conversations || []).slice(0, 10);
  r.dates = (r.dates || []).slice(0, 10).map(function (d) {
    d.costYen = Math.round(clampNum_(d.costYen, 0, 1000000, 0));
    return d;
  });

  const s = sh_(SHEET.LOGS);
  s.appendRow([
    'L' + Utilities.getUuid().replace(/-/g, '').slice(0, 12), u.userId, str_(p.name, 30),
    history.length, affinity, r.score, str_(r.verdict, 10),
    JSON.stringify({ partner: p, history: history }).slice(0, 45000),
    JSON.stringify(r).slice(0, 45000), new Date()
  ]);
  setProgress_(u, 4);
  return { result: r, user: publicUser_(u) };
}

function api_listLogs_(req, u) {
  const s = sh_(SHEET.LOGS);
  const last = s.getLastRow();
  if (last < 2) return { logs: [] };
  const v = s.getRange(2, 1, last - 1, LOG_COLS.length).getValues();
  const out = [];
  for (let i = v.length - 1; i >= 0 && out.length < 10; i--) {
    if (v[i][1] !== u.userId) continue;
    let result = null;
    try { result = JSON.parse(v[i][8]); } catch (e) { continue; }
    const date = v[i][9] instanceof Date ? v[i][9].toISOString() : String(v[i][9]);
    result.partnerName = v[i][2];
    result.date = date;
    out.push({ logId: v[i][0], partnerName: v[i][2], score: v[i][5], verdict: v[i][6], date: date, result: result });
  }
  return { logs: out };
}
