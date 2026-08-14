/**
 * Cloudflare Pages advanced-mode Worker — kantoku-lab の非公開ゲート。
 * 資格情報は Pages の環境変数だけで保持し、LAB_PASS 未設定時も配信しない。
 */
export default {
  async fetch(request, env) {
    if (!env.LAB_PASS) {
      return new Response('Locked (no credential configured).', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' }
      });
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
