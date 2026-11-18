/* consent.js v1.1 (18/11/2026; v1 de 17/11) — consentimento de cookies do RevalidaOSCE.
 *
 * Uma cópia idêntica vive em simulador/consent.js (são dois projetos da Vercel);
 * o portão 8 do CI confere que as duas são iguais byte a byte. Edite as duas juntas.
 *
 * Modelo estrito: antes do "Aceitar" não há tag do Google, nenhum cookie de
 * publicidade e nenhum cookie de origem (rosce_attr). A escolha fica em
 * rosce_consent = {"v":1,"ad":true|false,"ts":"AAAA-MM-DD"} no domínio
 * .revalidaosce.com.br, por 12 meses (cookie estritamente necessário).
 *
 * Uso nas páginas:
 *   script com src="/consent.js" no head, antes de qualquer script que use gtag;
 *   na landing e no planos, com data-atribuicao="landing" ou "planos": rótulos fixos
 *   nos links e, com aceite, gclid/utm (o antigo bloco v2.2 das páginas).
 *   window.RO_GTAG_CONFIG = {...}  antes do include: opções do gtag('config') da página
 *   RoConsent.quandoAceitar(fn)   roda fn uma vez, já ou quando a pessoa aceitar
 *   RoConsent.aoMudar(fn)         (v1.1) roda fn(ad) toda vez que a pessoa escolhe no banner
 *                                 (true = aceitou, false = recusou), depois de aplicar a escolha
 *   RoConsent.origem()            (v1.1) a origem do anúncio guardada no cookie de origem, só
 *                                 com aceite (sem aceite devolve null); só leitura, nunca grava
 *   script com data-sem-banner    não mostra o banner nessa página (ex.: /obrigado, que
 *                                 redireciona sozinha); o aceite já dado continua valendo
 *   link com data-ro-cookies (Preferências de cookies)  reabre o banner
 *
 * Falha silenciosa: nada aqui pode quebrar a página, o login ou o cadastro.
 * Não escreva a tag de fechamento de script neste arquivo, nem em comentário: os
 * portões 3 e 8 o embutem num script inline, e ela encerraria o bloco.
 */
(function () {
  'use strict';
  try {
    var V = 1;
    var AW = 'AW-18306871741';
    var NOME = 'rosce_consent';
    var ATTR = 'rosce_attr';
    var DOMINIO = /(^|\.)revalidaosce\.com\.br$/.test(location.hostname) ? '; domain=.revalidaosce.com.br' : '';
    var script = document.currentScript;
    var modoAtribuicao = (script && script.getAttribute('data-atribuicao')) || '';
    var semBanner = !!(script && script.hasAttribute('data-sem-banner'));
    var cfgPagina = window.RO_GTAG_CONFIG || null;

    /* ── cookies ─────────────────────────────────────────────────────────── */
    function lerCookie(n) {
      var m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)'));
      if (!m) return null;
      try { return JSON.parse(decodeURIComponent(m[1])); } catch (_e) { return null; }
    }
    function gravarCookie(n, valor, maxAge) {
      document.cookie = n + '=' + encodeURIComponent(JSON.stringify(valor)) + '; max-age=' + maxAge +
        '; path=/' + DOMINIO + '; SameSite=Lax; Secure';
    }
    function apagarCookie(n) {
      var h = location.hostname;
      var doms = ['', '; domain=' + h, '; domain=.' + h];
      if (DOMINIO) doms.push(DOMINIO, '; domain=revalidaosce.com.br');
      doms.forEach(function (d) { document.cookie = n + '=; max-age=0; path=/' + d; });
    }
    function apagarCookiesDePublicidade() {
      apagarCookie(ATTR);
      document.cookie.split(';').forEach(function (par) {
        var n = par.split('=')[0].trim();
        if (/^_gcl_|^_ga|^IDE$/.test(n)) apagarCookie(n);
      });
    }

    function estado() {
      var e = lerCookie(NOME);
      if (!e || e.v !== V || typeof e.ad !== 'boolean') return null;
      return e;
    }
    function aceito() { var e = estado(); return !!(e && e.ad === true); }
    // v1.1: leitura da origem para o simulador (que não pode citar o cookie); nunca grava.
    function origem() { return aceito() ? lerCookie(ATTR) : null; }

    /* ── tag do Google (só depois do aceite) ────────────────────────────── */
    var tagCarregada = false;
    // ad_personalization e analytics_storage ficam negados mesmo com o aceite: a política diz
    // que não usamos a tag para personalizar anúncios nem remarketing, e não há Google Analytics.
    var SIM = { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'denied' };
    var NAO = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' };
    function carregarTag() {
      if (tagCarregada) { window.gtag('consent', 'update', SIM); return; }
      tagCarregada = true;
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag('consent', 'default', NAO);
      window.gtag('consent', 'update', SIM);
      window.gtag('js', new Date());
      var cfg = { allow_ad_personalization_signals: false };
      if (cfgPagina) for (var k in cfgPagina) if (Object.prototype.hasOwnProperty.call(cfgPagina, k)) cfg[k] = cfgPagina[k];
      window.gtag('config', AW, cfg);
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + AW;
      (document.head || document.documentElement).appendChild(s);
    }

    /* ── atribuição (landing e planos) ──────────────────────────────────── */
    var ROTULOS = {
      landing: { source: 'landing', medium: 'landing_cta' },
      planos: { source: 'planos', medium: 'planos_cta' }
    };
    function linksAlvo() {
      var out = [];
      document.querySelectorAll('a[href]').forEach(function (a) {
        var h = a.getAttribute('data-ro-href') || a.getAttribute('href') || '';
        if (h.indexOf('pay.kiwify.com.br') < 0 && h.indexOf('simulador.revalidaosce.com.br') < 0) return;
        if (!a.hasAttribute('data-ro-href')) a.setAttribute('data-ro-href', h);  // href original, para refazer
        out.push(a);
      });
      return out;
    }
    // attr = {} sem consentimento: só rótulos fixos, nunca gclid/sck da URL ou de cookie.
    function decorar(attr) {
      var r = ROTULOS[modoAtribuicao] || ROTULOS.landing;
      var click = attr.gclid || attr.gbraid || attr.wbraid || '';
      linksAlvo().forEach(function (a) {
        var u;
        try { u = new URL(a.getAttribute('data-ro-href')); } catch (_e) { return; }
        if (u.hostname === 'pay.kiwify.com.br') {
          if (!u.searchParams.get('utm_source')) u.searchParams.set('utm_source', click ? 'google_ads' : (attr.utm_source || r.source));
          if (!u.searchParams.get('utm_medium')) u.searchParams.set('utm_medium', attr.utm_medium || r.medium);
          if (!u.searchParams.get('utm_campaign')) u.searchParams.set('utm_campaign', attr.utm_campaign || 'preco');
          if (click && !u.searchParams.get('sck')) u.searchParams.set('sck', click);
        } else {
          if (click && !u.searchParams.get('gclid')) u.searchParams.set('gclid', click);
          if (attr.utm_source && !u.searchParams.get('utm_source')) u.searchParams.set('utm_source', attr.utm_source);
        }
        a.setAttribute('href', u.toString());
      });
    }
    // Só chamada pelo ramo "aceito" (portão 8 confere): grava rosce_attr e decora com a origem.
    function atribuirComConsentimento() {
      var KEYS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
      var q = new URLSearchParams(location.search), fresco = {}, tem = false;
      KEYS.forEach(function (k) { var v = q.get(k); if (v) { fresco[k] = v.slice(0, 200); tem = true; } });
      var attr;
      if (tem) {
        attr = fresco; attr.ts = new Date().toISOString().slice(0, 10); attr.lp = location.pathname;
        gravarCookie(ATTR, attr, 7776000);  // 90 dias
      } else {
        attr = lerCookie(ATTR);
      }
      decorar(attr || {});
    }
    function quandoPronto(fn) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
    }

    /* ── callbacks das páginas ──────────────────────────────────────────── */
    var fila = [];
    function rodar(item) {
      if (item.feito) return;
      item.feito = true;
      try { item.fn(); } catch (_e) { /* nunca quebra a página */ }
    }
    function quandoAceitar(fn) {
      if (typeof fn !== 'function') return;
      var item = { fn: fn, feito: false };
      fila.push(item);
      if (aceito()) rodar(item);
    }

    // v1.1: quem precisa saber da escolha (o simulador apaga a origem gravada no banco ao recusar)
    var ouvintes = [];
    function aoMudar(fn) { if (typeof fn === 'function') ouvintes.push(fn); }
    function avisarMudanca(ad) {
      ouvintes.forEach(function (fn) { try { fn(ad); } catch (_e) { /* nunca quebra a página */ } });
    }

    function aplicarAceite() {
      carregarTag();
      if (modoAtribuicao) quandoPronto(atribuirComConsentimento);
      fila.forEach(rodar);
    }
    function aplicarRecusa(eraAceito) {
      if (eraAceito || tagCarregada) apagarCookiesDePublicidade();
      if (tagCarregada) { try { window.gtag('consent', 'update', NAO); } catch (_e) {} }
      if (modoAtribuicao) quandoPronto(function () { decorar({}); });
    }
    function escolher(ad) {
      var antes = aceito();
      gravarCookie(NOME, { v: V, ad: !!ad, ts: new Date().toISOString().slice(0, 10) }, 31536000);  // 12 meses
      fecharBanner();
      if (ad) aplicarAceite(); else aplicarRecusa(antes);
      avisarMudanca(!!ad);
    }

    /* ── banner ─────────────────────────────────────────────────────────── */
    var CSS =
      '#ro-consent{position:fixed;left:12px;right:12px;bottom:12px;z-index:250;max-width:760px;margin:0 auto;' +
      'background:#0a1520;color:#e8f0f8;border:1px solid rgba(255,255,255,.14);border-radius:14px;' +
      'box-shadow:0 10px 36px rgba(0,0,0,.45);padding:14px 16px;font:400 14px/1.45 "DM Sans",system-ui,-apple-system,Segoe UI,sans-serif;' +
      'display:flex;gap:14px;align-items:center;flex-wrap:wrap}' +
      '#ro-consent[hidden]{display:none!important}' +
      '#ro-consent p{margin:0;flex:1 1 320px;color:#c5d4e2}' +
      '#ro-consent a{color:#00c9ff;text-decoration:underline}' +
      '#ro-consent .ro-c-btns{display:flex;gap:8px;flex:0 0 auto}' +
      '#ro-consent button{font-weight:600;font-size:14px;line-height:1;font-family:inherit;padding:10px 18px;border-radius:10px;cursor:pointer;' +
      'background:transparent;color:#e8f0f8;border:1px solid rgba(255,255,255,.35);min-width:104px}' +
      '#ro-consent button:hover{border-color:#00c9ff;color:#00c9ff}' +
      '#ro-consent button:focus-visible{outline:2px solid #00c9ff;outline-offset:2px}' +
      '@media(max-width:520px){#ro-consent{left:8px;right:8px;bottom:8px;padding:12px}#ro-consent .ro-c-btns{width:100%}#ro-consent button{flex:1}}' +
      '@media print{#ro-consent,#ro-consent-espaco{display:none!important}}';
    var TEXTO =
      'Usamos cookies para medir de qual anúncio você veio. ' +
      '<a href="https://revalidaosce.com.br/politica-privacidade.html#cookies">Política de privacidade</a>';

    // No simulador o banner só aparece nas telas-hub: nunca no login, no paywall,
    // na estação nem no resultado (mesma regra do banner do trial).
    var HUBS = ['s-dashboard', 's-select', 's-history', 's-hist-detail', 's-marathon', 's-account', 's-messages'];
    function ehApp() { return !!document.getElementById('s-login') && !!document.querySelector('.screen'); }
    function telaPermite() {
      if (!ehApp()) return true;
      return HUBS.indexOf(document.body.getAttribute('data-screen') || '') >= 0;
    }

    var el = null, espaco = null, aberto = false;
    function montar() {
      if (el) return;
      var st = document.createElement('style');
      st.id = 'ro-consent-css';
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
      el = document.createElement('div');
      el.id = 'ro-consent';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Preferências de cookies');
      el.hidden = true;
      // z-index 250: acima da barra inferior e do menu do simulador, abaixo dos modais (300+)
      el.innerHTML = '<p>' + TEXTO + '</p><div class="ro-c-btns">' +
        '<button type="button" data-ro-c="sim">Aceitar</button>' +
        '<button type="button" data-ro-c="nao">Recusar</button></div>';
      el.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('button[data-ro-c]') : null;
        if (b) escolher(b.getAttribute('data-ro-c') === 'sim');
      });
      document.body.appendChild(el);
      if (ehApp()) {
        // no simulador, a política abre em outra aba para não tirar a pessoa do app
        var lk = el.querySelector('p a');
        if (lk) { lk.target = '_blank'; lk.rel = 'noopener'; }
      } else {
        // na landing, um espaço no fim da página para o banner não esconder o rodapé
        espaco = document.createElement('div');
        espaco.id = 'ro-consent-espaco';
        espaco.setAttribute('aria-hidden', 'true');
        espaco.style.height = '0px';
        document.body.appendChild(espaco);
      }
    }
    function posicionar() {
      if (!el) return;
      var mostrar = aberto && telaPermite();
      el.hidden = !mostrar;
      if (ehApp()) {
        var nav = document.getElementById('mobile-nav');
        var navVisivel = nav && !nav.classList.contains('nav-hidden') && nav.offsetHeight > 0;
        el.style.bottom = navVisivel ? (nav.offsetHeight + 8) + 'px' : '';
      } else if (espaco) {
        espaco.style.height = mostrar ? (el.offsetHeight + 24) + 'px' : '0px';
      }
    }
    function abrirBanner() {
      quandoPronto(function () {
        montar();
        aberto = true;
        posicionar();
      });
    }
    function fecharBanner() {
      aberto = false;
      posicionar();
    }

    quandoPronto(function () {
      // "Preferências de cookies" em qualquer página: reabre o banner
      document.addEventListener('click', function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest('[data-ro-cookies]') : null;
        if (!a) return;
        ev.preventDefault();
        abrirBanner();
      });
      if (ehApp() && window.MutationObserver) {
        new MutationObserver(posicionar).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
      }
      window.addEventListener('resize', posicionar);
      if (modoAtribuicao && !aceito()) decorar({});
    });

    window.RoConsent = {
      versao: V,
      estado: estado,
      aceito: aceito,
      quandoAceitar: quandoAceitar,
      aoMudar: aoMudar,
      origem: origem,
      abrir: abrirBanner
    };

    if (aceito()) aplicarAceite();
    else if (!estado() && !semBanner) abrirBanner();
  } catch (_e) { /* falha silenciosa */ }
})();
