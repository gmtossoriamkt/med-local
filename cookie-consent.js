/* Согласие на cookie и запуск Яндекс.Метрики только после согласия.
   Выбор хранится в localStorage (ключ cookieConsent). До нажатия «Принять» и после «Отклонить»
   Метрика не загружается и её cookie не устанавливаются. Изменить выбор можно по ссылке
   с атрибутом data-cookie-settings (в подвале сайта и в Политике конфиденциальности). */
(function () {
  'use strict';

  var KEY = 'cookieConsent';
  var METRIKA_ID = 110085907;
  var EN = String(document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  var T = EN ? {
    label: 'Cookie notice',
    text: 'We use cookies and Yandex.Metrica (session replay, click map) to analyse and improve the site. Analytics is switched on only if you accept. Details are in the <a href="/privacy#cookies">Privacy Policy</a>.',
    accept: 'Accept',
    decline: 'Decline'
  } : {
    label: 'Уведомление об использовании cookies',
    text: 'Мы используем cookie и сервис Яндекс.Метрика (вебвизор, карта кликов) для аналитики и улучшения сайта. Аналитика включается только с вашего согласия. Подробнее — в <a href="/privacy#cookies">Политике конфиденциальности</a>.',
    accept: 'Принять',
    decline: 'Отклонить'
  };

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY));
      return v && (v.v === 'granted' || v.v === 'denied') ? v.v : null;
    } catch (e) { return null; }
  }
  function write(value) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: value, t: new Date().toISOString() })); } catch (e) { /* без хранилища выбор не запомнится */ }
  }

  // Прежний баннер «Понятно» не был согласием: спрашиваем заново.
  try { localStorage.removeItem('cookieConsentAccepted'); } catch (e) { /* ignore */ }

  var metrikaLoaded = false;
  function loadMetrika() {
    if (metrikaLoaded) return;
    metrikaLoaded = true;
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0]; k.async = 1; k.src = r;
      a.parentNode.insertBefore(k, a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js', 'ym');
    window.ym(METRIKA_ID, 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true });
  }

  function clearMetrikaData() {
    var host = location.hostname;
    var parts = host.split('.');
    var domains = [host, '.' + host];
    if (parts.length > 2) domains.push('.' + parts.slice(-2).join('.'));
    document.cookie.split(';').forEach(function (c) {
      var name = c.split('=')[0].trim();
      if (!/^_ym/.test(name)) return;
      domains.forEach(function (d) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + d;
      });
      document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    });
    try {
      Object.keys(localStorage).forEach(function (k) { if (/^_ym/.test(k)) localStorage.removeItem(k); });
      Object.keys(sessionStorage).forEach(function (k) { if (/^_ym/.test(k)) sessionStorage.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  function addStyles() {
    if (document.getElementById('cookie-consent-style')) return;
    var style = document.createElement('style');
    style.id = 'cookie-consent-style';
    style.textContent = '#cookie-consent-banner{position:fixed;left:0;right:0;bottom:0;z-index:200;background:#1C232E;color:#C7CEDA;padding:16px 22px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-family:"Onest",system-ui,sans-serif;font-size:13.5px;line-height:1.5;box-shadow:0 -8px 24px rgba(0,0,0,.22)}' +
      '#cookie-consent-banner p{margin:0;flex:1;min-width:240px}' +
      '#cookie-consent-banner a{color:#2FA8A0;text-decoration:none}' +
      '#cookie-consent-banner a:hover{text-decoration:underline}' +
      '#cookie-consent-banner .cc-btns{display:flex;gap:10px;flex-wrap:wrap}' +
      '#cookie-consent-banner button{border-radius:10px;padding:10px 20px;min-width:112px;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit;border:1.5px solid #2FA8A0}' +
      '#cookie-consent-banner .cc-accept{background:#2FA8A0;color:#fff}' +
      '#cookie-consent-banner .cc-decline{background:transparent;color:#fff}' +
      '#cookie-consent-banner button:hover{filter:brightness(1.12)}' +
      '@media(max-width:600px){#cookie-consent-banner{padding:14px 16px}#cookie-consent-banner .cc-btns{width:100%}#cookie-consent-banner button{flex:1}}';
    document.head.appendChild(style);
  }

  function hide() {
    var b = document.getElementById('cookie-consent-banner');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  function choose(value) {
    var before = read();
    write(value);
    hide();
    if (value === 'granted') {
      loadMetrika();
    } else {
      clearMetrikaData();
      if (before === 'granted' && metrikaLoaded) location.reload(); // остановить уже загруженный счётчик
    }
  }

  function show() {
    if (document.getElementById('cookie-consent-banner')) return;
    addStyles();
    var banner = document.createElement('div');
    banner.id = 'cookie-consent-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', T.label);
    banner.innerHTML = '<p>' + T.text + '</p><div class="cc-btns">' +
      '<button type="button" class="cc-accept" id="cookie-consent-accept">' + T.accept + '</button>' +
      '<button type="button" class="cc-decline" id="cookie-consent-decline">' + T.decline + '</button></div>';
    document.body.appendChild(banner);
    document.getElementById('cookie-consent-accept').addEventListener('click', function () { choose('granted'); });
    document.getElementById('cookie-consent-decline').addEventListener('click', function () { choose('denied'); });
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-cookie-settings]') : null;
    if (a) { e.preventDefault(); show(); }
  });

  function start() {
    var state = read();
    if (state === 'granted') loadMetrika();
    else if (state === null) show();
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
