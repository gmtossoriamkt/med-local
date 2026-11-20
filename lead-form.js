/* Отправка форм заявок на сервер в Российской Федерации (Yandex Cloud Functions).
   Заявка уходит письмом на info@med-local.ru. Форма отправляется как обычная urlencoded-форма,
   поэтому браузер не делает предварительный CORS-запрос. Исходный код функции: deploy/form-handler-yc/index.js */
(function () {
  'use strict';

  var ENDPOINT = 'https://functions.yandexcloud.net/d4eb8i488l7s13qf16jd';
  var EN = String(document.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  var T = EN ? {
    sending: 'Sending...',
    okTitle: 'Request received!',
    okText: 'We will contact you within one business day.',
    nextTitle: 'What happens next',
    next: ['A specialist will review your request and check the applicable requirements.', 'We will contact you by the phone number you left and clarify the details.'],
    prepTitle: 'To speed up the review, prepare:',
    prep: ['OKPD2 and device-type (NKMI) codes, if known', 'a component list or a description of the device', 'where and how the device is produced'],
    readTitle: 'While you wait',
    links: [['/en/assessment/', 'Localization quick assessment'], ['/en/localization/', 'Localization of medical devices'], ['/en/pricing/', 'Pricing']],
    urgent: 'Urgent question? Call',
    errGeneric: 'Could not send the request. Please try again or write to info@med-local.ru.',
    errMany: 'Too many requests. Please try again in a few minutes or write to info@med-local.ru.',
    errInvalid: 'Please check your name and phone number.',
    errConsent: 'Please confirm your consent to personal data processing.'
  } : {
    sending: 'Отправляем...',
    okTitle: 'Заявка принята!',
    okText: 'Мы свяжемся с вами в течение одного рабочего дня.',
    nextTitle: 'Что будет дальше',
    next: ['Специалист изучит ваш запрос и проверит применимые требования.', 'Мы свяжемся с вами по указанному телефону и уточним детали.'],
    prepTitle: 'Чтобы ускорить проверку, подготовьте:',
    prep: ['коды ОКПД2 и вида МИ по НКМИ, если известны', 'спецификацию компонентов или описание изделия', 'сведения о том, где и как изделие производится'],
    readTitle: 'Пока ждёте',
    links: [['/ocenka-lokalizacii/', 'Экспресс-оценка локализации'], ['/blog/advalornaya-dolya/', 'Адвалорная доля по ПП 719'], ['/blog/pp719-checklist/', 'Чек-лист экспертизы ТПП по ПП 719'], ['/blog/pp1875-vtoroy-lishniy/', '«Второй лишний» по ПП 1875']],
    urgent: 'Срочный вопрос? Позвоните',
    errGeneric: 'Не удалось отправить заявку. Попробуйте ещё раз или напишите на info@med-local.ru.',
    errMany: 'Слишком много запросов. Попробуйте через несколько минут или напишите на info@med-local.ru.',
    errInvalid: 'Проверьте имя и номер телефона.',
    errConsent: 'Подтвердите согласие на обработку персональных данных.'
  };

  function field(f, name) {
    var el = f.elements[name];
    return el && typeof el.value === 'string' ? el.value : '';
  }

  function showError(f, btn, label, text) {
    btn.textContent = label;
    btn.disabled = false;
    f.removeAttribute('data-sending');
    var old = f.querySelector('[data-lead-error]');
    if (old) old.parentNode.removeChild(old);
    var p = document.createElement('p');
    p.setAttribute('data-lead-error', '');
    p.setAttribute('role', 'alert');
    p.style.cssText = 'color:#b42318;font-size:13px;margin:10px 0 0';
    p.textContent = text;
    btn.parentNode.insertBefore(p, btn.nextSibling);
  }

  function li(t) { return '<li>' + t + '</li>'; }
  function thanksHtml() {
    var here = location.pathname;
    var links = T.links.filter(function (l) { return here.indexOf(l[0]) !== 0; }).slice(0, 3).map(function (l) {
      return '<a href="' + l[0] + '" style="color:var(--cyan);font-weight:600">' + l[1] + ' →</a>';
    }).join('<br>');
    var ul = 'margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.7;color:var(--ink)';
    return '<div data-lead-thanks style="padding:26px 6px;text-align:left">' +
      '<div style="text-align:center"><div style="font-size:36px;margin-bottom:12px">✅</div>' +
      '<h3 style="font-size:20px;font-weight:800;margin:0 0 8px">' + T.okTitle + '</h3>' +
      '<p style="color:var(--muted);margin:0 0 20px">' + T.okText + '</p></div>' +
      '<div style="font-size:14px;font-weight:700">' + T.nextTitle + '</div><ol style="' + ul + '">' + T.next.map(li).join('') + '</ol>' +
      '<div style="font-size:14px;font-weight:700;margin-top:16px">' + T.prepTitle + '</div><ul style="' + ul + '">' + T.prep.map(li).join('') + '</ul>' +
      (links ? '<div style="font-size:14px;font-weight:700;margin-top:16px">' + T.readTitle + '</div><p style="font-size:14px;line-height:1.9;margin:6px 0 0">' + links + '</p>' : '') +
      '<p style="font-size:14px;margin:18px 0 0;color:var(--muted)">' + T.urgent + ' <a href="tel:+79853169104" style="color:var(--cyan);font-weight:700;white-space:nowrap">+7 985 316-91-04</a></p></div>';
  }

  function submitLead(f) {
    if (f.getAttribute('data-sending')) return false;
    var btn = f.querySelector('button[type=submit]');
    var label = btn.textContent;
    var cb = f.querySelector('input[type=checkbox]');

    var body = new URLSearchParams();
    ['name', 'phone', 'device', 'email', 'website'].forEach(function (k) { body.set(k, field(f, k)); });
    body.set('consent', cb && cb.checked ? 'on' : '');
    body.set('page', location.pathname + location.search);
    body.set('lang', EN ? 'en' : 'ru');

    var old = f.querySelector('[data-lead-error]');
    if (old) old.parentNode.removeChild(old);
    f.setAttribute('data-sending', '1');
    btn.textContent = T.sending;
    btn.disabled = true;

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString()
    }).then(function (r) {
      return r.json().then(function (d) { return { status: r.status, data: d }; }, function () { return { status: r.status, data: {} }; });
    }).then(function (res) {
      if (res.status === 200 && res.data && res.data.ok) {
        try { if (typeof window.ym === 'function') window.ym(110085907, 'reachGoal', 'lead_submit'); } catch (e) { /* цель не критична */ }
        f.innerHTML = thanksHtml();
        try { f.setAttribute('data-lead-done', '1'); f.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* не критично */ }
      } else if (res.status === 429) {
        showError(f, btn, label, T.errMany);
      } else if (res.status === 422) {
        showError(f, btn, label, res.data && res.data.error === 'no_consent' ? T.errConsent : T.errInvalid);
      } else {
        showError(f, btn, label, T.errGeneric);
      }
    }).catch(function () {
      showError(f, btn, label, T.errGeneric);
    });
    return false;
  }

  // Скрытое поле-ловушка для ботов: человек его не видит и не заполняет.
  Array.prototype.forEach.call(document.querySelectorAll('form.frm'), function (f) {
    if (f.elements.website) return;
    var h = document.createElement('input');
    h.type = 'text';
    h.name = 'website';
    h.tabIndex = -1;
    h.autocomplete = 'off';
    h.setAttribute('aria-hidden', 'true');
    h.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
    f.appendChild(h);
  });

  window.submitLead = submitLead;
  window.sendLead = submitLead;
})();
