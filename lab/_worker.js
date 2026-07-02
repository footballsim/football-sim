/**
 * Cloudflare Pages advanced-mode Worker — 非公開ベータのBasic認証ゲート。
 * _worker.js は全リクエストのエントリになるため、静的アセットより先に必ず実行される。
 * 合い言葉が一致しない限り 401 を返し中身を一切出さない。合い言葉は env.LAB_PASS
 * (Pagesシークレット) で保持しデプロイ物・クライアントに露出しない。未設定は fail-closed(503)。
 */
export default {
  async fetch(request, env) {
    if (!env.LAB_PASS) {
      return new Response('Locked (no credential configured).', { status: 503 });
    }
    const user = env.LAB_USER || 'kantoku';
    const expected = 'Basic ' + btoa(user + ':' + env.LAB_PASS);
    const got = request.headers.get('Authorization') || '';
    if (got !== expected) {
      return new Response('Private beta — authentication required.', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="Kantoku private beta", charset="UTF-8"',
          'Cache-Control': 'no-store'
        }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
