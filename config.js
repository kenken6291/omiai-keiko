/* =========================================================
 * お見合い稽古（omiai-keiko）設定ファイル
 * GASを再デプロイしてURLが変わったら、ここだけ書き換える
 * ========================================================= */
window.APP_CONFIG = {
  // GAS ウェブアプリのURL
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwomPEDEZONIYfzld5GqEYBL0O3-37txQSTf9spMe810yBzTpTddiV030yEYRzRnZLr/exec',

  // バージョン情報
  APP_VERSION: '1.0.1',
  BUILD_DATE: '2026-10-11',

  // 更新履歴（新しい順）
  CHANGELOG: [
    { version: '1.0.1', date: '2026-10-11', notes: ['GAS URLを config.js に分離', 'バージョン情報の表示を追加（ヘッダー・フッター・詳細画面）'] },
    { version: '1.0.0', date: '2026-10-11', notes: ['初版：会員認証、音声ヒアリング、身だしなみ相談、模擬お見合い、結果と提案'] }
  ]
};
