/* =========================================================
 * お見合い稽古（omiai-keiko）設定ファイル
 * GASを再デプロイしてURLが変わったら、ここだけ書き換える
 * ========================================================= */
window.APP_CONFIG = {
  // GAS ウェブアプリのURL
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwomPEDEZONIYfzld5GqEYBL0O3-37txQSTf9spMe810yBzTpTddiV030yEYRzRnZLr/exec',

  // バージョン情報
  APP_VERSION: '1.0.2',
  BUILD_DATE: '2026-10-11',

  // 更新履歴（新しい順）
  CHANGELOG: [
    { version: '1.0.2', date: '2026-10-11', notes: ['音声入力で同じ言葉がくり返される不具合を修正（Android対策）', 'お相手の写真（Driveに登録した人）を選べるように変更', 'お相手の名前・年齢・職業・趣味・人柄を指定できるように変更', '写真の日本語ファイル名（普通の顔・笑顔・驚き顔・困り顔／瞬き・しゃべり）に対応'] },
    { version: '1.0.1', date: '2026-10-11', notes: ['GAS URLを config.js に分離', 'バージョン情報の表示を追加（ヘッダー・フッター・詳細画面）'] },
    { version: '1.0.0', date: '2026-10-11', notes: ['初版：会員認証、音声ヒアリング、身だしなみ相談、模擬お見合い、結果と提案'] }
  ]
};
