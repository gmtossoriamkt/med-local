(function(){
  if (localStorage.getItem('cookieConsentAccepted') === '1') return;

  var style = document.createElement('style');
  style.textContent = '#cookie-consent-banner{position:fixed;left:0;right:0;bottom:0;z-index:200;background:#1C232E;color:#C7CEDA;padding:16px 22px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-family:"Onest",system-ui,sans-serif;font-size:13.5px;line-height:1.5;box-shadow:0 -8px 24px rgba(0,0,0,.22)}' +
    '#cookie-consent-banner p{margin:0;flex:1;min-width:240px}' +
    '#cookie-consent-banner a{color:#2FA8A0;text-decoration:none}' +
    '#cookie-consent-banner a:hover{text-decoration:underline}' +
    '#cookie-consent-banner button{background:#2FA8A0;color:#fff;border:none;border-radius:10px;padding:10px 20px;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit}' +
    '#cookie-consent-banner button:hover{filter:brightness(1.08)}' +
    '@media(max-width:600px){#cookie-consent-banner{padding:14px 16px}}';
  document.head.appendChild(style);

  var banner = document.createElement('div');
  banner.id = 'cookie-consent-banner';
  banner.setAttribute('role', 'region');
  banner.setAttribute('aria-label', 'Уведомление об использовании cookies');
  banner.innerHTML = '<p>Мы используем cookies для аналитики и улучшения работы сайта. Продолжая пользоваться сайтом, вы соглашаетесь с использованием cookies согласно <a href="/privacy">Политике конфиденциальности</a>.</p><button type="button" id="cookie-consent-accept">Понятно</button>';

  function insert(){
    document.body.appendChild(banner);
    document.getElementById('cookie-consent-accept').addEventListener('click', function(){
      localStorage.setItem('cookieConsentAccepted', '1');
      banner.remove();
    });
  }

  if (document.body) insert();
  else document.addEventListener('DOMContentLoaded', insert);
})();
