/**
 * Cloudflare Pages advanced-mode Worker — kantoku-lab 配信エントリ。
 *
 * ⚠️ 2026-07-24 ユーザー指示で Basic 認証ゲートを撤去（パスワードなし）。
 *   理由: ホーム画面追加(standalone)だと iOS が Basic 認証の資格情報を毎回忘れ、
 *   起動ごとに白画面＋パス入力になり手間だったため。トレードオフ＝URL を知っていれば
 *   誰でもアクセス可能（開発中のリーグが実質公開）。URL は公開の場にリンクしていない＋
 *   robots.txt で Disallow のまま＝検索には載りにくい。
 *
 *   ★ 再び鍵をかけたくなったら、下の PASS-THROUGH を消して以下を復活させる:
 *     if (!env.LAB_PASS) return new Response('Locked (no credential configured).', { status: 503 });
 *     const user = env.LAB_USER || 'kantoku';
 *     const expected = 'Basic ' + btoa(user + ':' + env.LAB_PASS);
 *     if ((request.headers.get('Authorization') || '') !== expected) {
 *       return new Response('Private beta — authentication required.', {
 *         status: 401,
 *         headers: { 'WWW-Authenticate': 'Basic realm="Kantoku private beta", charset="UTF-8"', 'Cache-Control': 'no-store' }
 *       });
 *     }
 *   （Pages シークレット LAB_PASS はそのまま残しておけば復活は上記だけで済む。）
 */
export default {
  async fetch(request, env) {
    // PASS-THROUGH（認証なし）＝静的アセットをそのまま返す。
    return env.ASSETS.fetch(request);
  }
};
