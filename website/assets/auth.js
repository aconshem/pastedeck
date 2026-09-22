/*
 * PasteDeck mock authentication.
 * Everything here is fake on purpose. To go real (flag `realAuth`), replace ONLY the bodies of
 * signInWithGoogle / sendMagicLink / verifyMagicLink / session / signOut — the pages never touch storage directly.
 *   Google:      redirect to your OAuth endpoint, receive a session cookie or token on return.
 *   Magic link:  POST email to /api/auth/magic-link, then verify the token from the emailed URL.
 */
(function (g) {
  'use strict';
  const KEY = 'pd_auth', PENDING = 'pd_magic', INTENT = 'pd_plan_intent';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };

  const Auth = {
    mocked: true,
    session() { return read(KEY); },
    start(user) {
      const s = Object.assign({ token: 'mock_' + rand(), signedInAt: Date.now() }, user);
      localStorage.setItem(KEY, JSON.stringify(s));
      localStorage.removeItem(PENDING);
      return s;
    },
    async signInWithGoogle() {
      await wait(450);
      return this.start({ provider: 'google', email: 'you@gmail.com', name: 'Demo User' });
    },
    async sendMagicLink(email) {
      email = String(email || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
      await wait(450);
      const token = rand();
      localStorage.setItem(PENDING, JSON.stringify({ email, token, at: Date.now() }));
      return { sent: true, email, devToken: token };
    },
    async verifyMagicLink(token) {
      const p = read(PENDING);
      if (!p || p.token !== token) throw new Error('This link is not valid any more. Request a new one.');
      if (Date.now() - p.at > 15 * 60000) throw new Error('This link expired. Request a new one.');
      return this.start({ provider: 'email', email: p.email, name: p.email.split('@')[0] });
    },
    signOut() { localStorage.removeItem(KEY); },
    rememberPlanIntent(plan) { if (plan) localStorage.setItem(INTENT, plan); },
    planIntent() { return localStorage.getItem(INTENT); },
  };
  g.PDAuth = Auth;
})(window);
