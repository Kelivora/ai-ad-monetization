/* AI Ad Monetization, site.js
   Language switch, verification ledger, format filter, reveals, clock.
   Everything works without this file: the HTML defaults to English, all tools on, all passed. */
(() => {
  'use strict';

  const doc = document;
  const html = doc.documentElement;
  const KEY = 'aam-lang';

  const D = (en, zh) => (html.getAttribute('data-lang') === 'zh' ? zh : en);
  const lang = () => (html.getAttribute('data-lang') === 'zh' ? 'zh' : 'en');

  /* ---------- language ---------- */

  const promptDefaults = { en: 'Banner, interstitial, rewarded', zh: '横幅、插屏、激励视频' };

  function applyLang() {
    const l = lang();
    html.setAttribute('data-lang', l);
    html.lang = l === 'zh' ? 'zh' : 'en';

    const title = doc.querySelector('title');
    if (title) doc.title = l === 'zh' ? (title.dataset.zhTitle || doc.title) : (title.dataset.enTitle || doc.title);

    const toggle = doc.getElementById('lang-toggle');
    if (toggle) toggle.textContent = l === 'zh' ? 'English' : '中文';

    // input placeholders and the default prompt value
    doc.querySelectorAll('input[data-zh-placeholder]').forEach((el) => {
      el.placeholder = l === 'zh' ? el.dataset.zhPlaceholder : el.dataset.enPlaceholder;
    });
    const prompt = doc.getElementById('prompt-input');
    if (prompt) {
      const v = prompt.value;
      if (v === promptDefaults.en || v === promptDefaults.zh) prompt.value = promptDefaults[l];
    }

    // image alt text (remember the English original on first pass)
    doc.querySelectorAll('img[data-zh-alt]').forEach((img) => {
      if (!img.dataset.enAlt) img.dataset.enAlt = img.alt;
      img.alt = l === 'zh' ? img.dataset.zhAlt : img.dataset.enAlt;
    });

    renderLedger();
    renderFormats();
  }

  const toggle = doc.getElementById('lang-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const next = lang() === 'zh' ? 'en' : 'zh';
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode */ }
      html.setAttribute('data-lang', next);
      applyLang();
    });
  }

  /* ---------- verification ledger ---------- */

  const ledgerEl = doc.querySelector('.ledger');

  const LEDGER = {
    passed: { en: 'passed', zh: '通过' },
    skipped: { en: 'skipped', zh: '跳过' },
    manual: { en: 'needs a person to check', zh: '需要人来核对' },
    staticDetail: { en: '21 passed, 0 failed', zh: '21 项通过，0 项失败' },
    runtimePassed: { en: '6 of 6 checks passed', zh: '6 项全部通过' },
    androidWarn: { en: 'Android build not verified.', zh: 'Android 构建未验证。' },
    iosWarn: { en: 'iOS build not verified.', zh: 'iOS 构建未验证。' },
    bothRan: { en: 'Android and iOS both built.', zh: 'Android 和 iOS 都完成了构建。' },
  };

  function ledgerText(key) { return D(LEDGER[key].en, LEDGER[key].zh); }

  function renderLedger() {
    if (!ledgerEl || !ledgerEl.querySelector('input')) return; // no checkboxes, keep static HTML
    const t = {};
    ledgerEl.querySelectorAll('input[data-tool]').forEach((cb) => { t[cb.dataset.tool] = cb.checked; });

    // static level: pure config checks, needs no toolchain
    const staticStatus = ledgerEl.querySelector('[data-ledger="static-status"]');
    if (staticStatus) {
      staticStatus.textContent = ledgerText('passed');
      staticStatus.classList.add('is-passed');
      const det = ledgerEl.querySelector('[data-ledger="static-detail"]');
      if (det) det.textContent = ledgerText('staticDetail');
    }

    // build steps
    const steps = {
      'step-pubget': t.flutter,
      'step-analyze': t.flutter,
      'step-android': t.flutter && t.jdk,
      'step-ios': t.flutter && t.xcode,
    };
    for (const [name, ok] of Object.entries(steps)) {
      const el = ledgerEl.querySelector(`[data-ledger="${name}"]`);
      if (!el) continue;
      el.textContent = ledgerText(ok ? 'passed' : 'skipped');
      el.classList.toggle('is-passed', ok);
      el.classList.toggle('is-skipped', !ok);
    }

    // build level: skipped when Flutter is off (all four steps skip);
    // otherwise passed only when at least one platform build passed and none failed
    const androidOk = steps['step-android'] === true;
    const iosOk = steps['step-ios'] === true;
    let buildStatus;
    if (!t.flutter) buildStatus = 'skipped';
    else buildStatus = (androidOk || iosOk) ? 'passed' : 'skipped'; // never passed without a platform build
    const buildEl = ledgerEl.querySelector('[data-ledger="build-status"]');
    if (buildEl) {
      buildEl.textContent = ledgerText(buildStatus);
      buildEl.classList.toggle('is-passed', buildStatus === 'passed');
      buildEl.classList.toggle('is-skipped', buildStatus === 'skipped');
    }

    // runtime: a device is a person's job to provide
    const runtimeStatus = t.device ? 'passed' : 'manual';
    const runtimeEl = ledgerEl.querySelector('[data-ledger="runtime-status"]');
    if (runtimeEl) {
      runtimeEl.textContent = ledgerText(runtimeStatus);
      runtimeEl.classList.toggle('is-passed', runtimeStatus === 'passed');
      runtimeEl.classList.toggle('is-manual', runtimeStatus === 'manual');
      const det = ledgerEl.querySelector('[data-ledger="runtime-detail"]');
      if (det) det.textContent = t.device ? ledgerText('runtimePassed') : '';
    }

    // footer: full ink when a platform was skipped
    const warns = [];
    if (!androidOk) warns.push(ledgerText('androidWarn'));
    if (!iosOk) warns.push(ledgerText('iosWarn'));
    const footer = ledgerEl.querySelector('[data-ledger="footer"]');
    if (footer) {
      footer.textContent = warns.length ? warns.join(' ') : ledgerText('bothRan');
      footer.classList.toggle('is-warn', warns.length > 0);
    }
  }

  if (ledgerEl) {
    ledgerEl.querySelectorAll('input[data-tool]').forEach((cb) => {
      cb.addEventListener('change', renderLedger);
    });
  }

  /* ---------- format rows ---------- */

  const promptInput = doc.getElementById('prompt-input');
  const rowsEl = doc.getElementById('format-rows');

  const FORMATS = [
    { test: /banner|横幅/i, name: { en: 'Banner', zh: '横幅' } },
    { test: /interstitial|插屏/i, name: { en: 'Interstitial', zh: '插屏' } },
    { test: /rewarded|激励/i, name: { en: 'Rewarded', zh: '激励视频' } },
  ];
  const META = { en: 'Google test ad, Android and iOS', zh: 'Google 测试广告，Android 和 iOS' };
  const EMPTY = { en: 'Name the ads you want.', zh: '写下你要的广告。' };

  function renderFormats() {
    if (!promptInput || !rowsEl) return;
    const v = promptInput.value;
    const hits = v.trim() ? FORMATS.filter((f) => f.test.test(v)) : [];
    if (!hits.length) {
      rowsEl.innerHTML = '';
      const li = doc.createElement('li');
      li.className = 'fmt-empty';
      li.textContent = D(EMPTY.en, EMPTY.zh);
      rowsEl.appendChild(li);
      return;
    }
    rowsEl.innerHTML = '';
    for (const f of hits) {
      const li = doc.createElement('li');
      li.className = 'matched';
      const name = doc.createElement('span');
      name.className = 'fmt-name';
      name.textContent = D(f.name.en, f.name.zh);
      const meta = doc.createElement('span');
      meta.className = 'fmt-meta';
      meta.textContent = D(META.en, META.zh);
      li.append(name, meta);
      rowsEl.appendChild(li);
    }
  }

  if (promptInput) {
    promptInput.addEventListener('input', renderFormats);
    doc.querySelectorAll('.refill').forEach((btn) => {
      btn.addEventListener('click', () => {
        promptInput.value = lang() === 'zh' ? btn.dataset.refillZh : btn.dataset.refillEn;
        renderFormats();
      });
    });
  }

  /* ---------- reveal on scroll ---------- */

  const revealEls = [...doc.querySelectorAll('[data-reveal]')];
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
        }
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.1 });
      revealEls.forEach((el) => io.observe(el));
    } else {
      revealEls.forEach((el) => el.classList.add('is-in'));
    }
  }

  /* ---------- local time (once a minute) ---------- */

  const clock = doc.getElementById('local-time');
  if (clock) {
    const tick = () => {
      clock.textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    };
    tick();
    setInterval(tick, 60000);
  }

  /* ---------- boot ---------- */

  applyLang();
})();
