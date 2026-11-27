/*
 * Les pages de l'équipe (tableau-de-bord.html, gestion-commandes.html) : l'accès, commun aux deux.
 * Se connecter, faire partie de l'équipe (administrateur, ou rôle « tableau »), puis la double
 * authentification : activée ici la première fois (code à scanner), demandée ensuite à chaque connexion.
 * Le serveur vérifie tout cela de son côté ; la page ne fait que guider.
 *
 * staffPage({ body, what, load }) : body, l'identifiant du contenu de la page ; what, ce que la page
 * montre (« le tableau de bord ») ; load(A), qui lit et affiche les données (A : le module des comptes).
 */
const $ = (id) => document.getElementById(id);

export function staffPage({ body, what, load }) {
  let A = null, busy = false, loadedAt = 0, factorId = null;
  const status = (text) => { const el = $('tb-status'); el.textContent = text || ''; el.hidden = !text; };
  // la porte : 'signin' (pas connecté), 'notadmin', 'enroll' (double authentification à activer), 'verify' (code)
  function gate(kind) {
    const texts = {
      signin: `Connectez-vous avec un compte de l’équipe pour voir ${what}.`,
      notadmin: 'Cette page est réservée à l’équipe du site.',
      enroll: `${what.charAt(0).toUpperCase()}${what.slice(1)} demande la double authentification : activez-la une fois, avec une application d’authentification sur votre téléphone.`,
      verify: `Pour voir ${what}, saisissez le code de votre application d’authentification.`,
    };
    $('tb-gate').hidden = !kind;
    $(body).hidden = !!kind || !$(body).childElementCount;
    if (!kind) return;
    $('tb-gate-text').textContent = texts[kind];
    $('tb-signin-btn').hidden = kind !== 'signin';
    $('tb-enroll').hidden = kind !== 'enroll';
    $('tb-mfa').hidden = kind !== 'verify';
    $('tb-qr').hidden = true;
    factorId = null;
    $('tb-when').textContent = '';
    if (kind === 'verify') setTimeout(() => $('tb-code').focus(), 50);
  }
  async function reload() {
    if (busy || !A) return;
    busy = true;
    $('tb-refresh').classList.add('spin');
    status('');
    try {
      await load(A);
      loadedAt = Date.now();
    } catch (e) {
      console.error(e);
      status(`${what.charAt(0).toUpperCase()}${what.slice(1)} n’a pas pu être chargé : ${(e && e.message) || ''}`);
      if (!loadedAt) $('tb-when').textContent = '';
    } finally {
      busy = false;
      $('tb-refresh').classList.remove('spin');
    }
  }
  async function start(user) {
    if (!user) { gate('signin'); return; }
    if (!(A.canDashboard ? A.canDashboard() : A.isAdmin())) { gate('notadmin'); return; }
    let st = 'ok';
    try { st = await A.mfaState(); } catch (e) { console.error(e); }
    if (st === 'enroll' || st === 'verify') { gate(st); return; }
    gate(null);
    await reload();
  }
  $('tb-signin-btn').addEventListener('click', () => { if (window.SiteAccount) window.SiteAccount.open(); });
  // la double authentification activée ici : le code à scanner, puis le premier code saisi la valide
  $('tb-enroll').addEventListener('click', async () => {
    const b = $('tb-enroll');
    b.disabled = true;
    status('');
    try {
      const f = await A.mfaEnroll();
      factorId = f.factorId;
      if (f.qr) $('tb-qr-img').src = f.qr; else $('tb-qr-img').hidden = true;
      $('tb-qr-secret').textContent = f.secret || '';
      $('tb-qr').hidden = false;
      $('tb-mfa').hidden = false;
      b.hidden = true;
      setTimeout(() => $('tb-code').focus(), 50);
    } catch (e) {
      status((e && e.message) || 'La double authentification n’a pas pu être préparée.');
    } finally { b.disabled = false; }
  });
  $('tb-refresh').addEventListener('click', () => { if (A && A.user()) start(A.user()); });
  $('tb-mfa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = $('tb-code-ok');
    ok.disabled = true;
    status('');
    try {
      await A.mfaVerify($('tb-code').value, factorId || undefined);
      $('tb-code').value = '';
      await start(A.user());
    } catch (err) {
      status((err && err.message) || 'Code refusé.');
    } finally { ok.disabled = false; }
  });
  // de retour sur l'onglet (un fichier préparé dans l'atelier, un autre membre de l'équipe…) : relue
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && loadedAt && Date.now() - loadedAt > 30e3 && A && A.user()) reload();
  });
  (async () => {
    try {
      A = await window.SiteAccount.account();
      let first = true;
      A.onChange((u) => { first = false; start(u); });
      setTimeout(() => { if (first) start(A.user()); }, 1500);
    } catch (e) {
      console.error(e);
      $('tb-when').textContent = '';
      status((e && e.message) || 'Le service des comptes n’est pas disponible pour le moment.');
    }
  })();
  return { reload, status, account: () => A };
}
