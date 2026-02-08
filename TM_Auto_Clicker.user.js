// ==UserScript==
// @name         TM Auto Clicker (gcp.giftee.biz + x.com)
// @namespace    https://example.local/
// @version      1.0.0
// @description  Auto click with debug + safety for gcp.giftee.biz and x.com OAuth2.
// @match        https://gcp.giftee.biz/*
// @match        https://x.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
// @updateURL    https://raw.githubusercontent.com/myhomeayu/tamper-scripts/main/TM_Auto_Clicker.user.js
// @downloadURL  https://raw.githubusercontent.com/myhomeayu/tamper-scripts/main/TM_Auto_Clicker.user.js

(() => {
  'use strict';

  // ==============================
  // Config
  // ==============================
  const DEBUG = true; // true: verbose, false: minimal logs

  const LOG_PREFIX = '[TM-AUTO]';

  // GCP
  const GCP_DELAY_MIN_MS = 9500;
  const GCP_DELAY_MAX_MS = 12000;
  const GCP_GUARD_PREFIX = 'tm_autoclick_gcp:';
  const GCP_RESULT_GUARD_PREFIX = 'tm_autoclick_gcp_result:';
  const GCP_RESULT_DELAY_MS = 1000;

  // X OAuth
  const X_DELAY_MIN_MS = 1800;
  const X_DELAY_MAX_MS = 2600;
  const X_GUARD_PREFIX = 'tm_autoclick_xoauth:';

  const OBSERVER_TIMEOUT_MS = 60000;
  const MAX_ATTEMPTS_PER_PAGE = 3;
  const MAX_DUMP_CANDIDATES = 10;

  const X_TEXT_MATCHERS = [
    'アプリにアクセスを許可',
    'Authorize app',
    'Allow',
    '許可',
    'Authorize'
  ];

  // ==============================
  // State
  // ==============================
  const state = {
    phase: 'init',
    attempts: 0,
    guardKey: null,
    lastCandidateCount: 0,
    lastFoundLabel: null,
    observerActive: false,
    lastError: null
  };

  // ==============================
  // Logging
  // ==============================
  function log(...args) {
    if (DEBUG) console.log(LOG_PREFIX, ...args);
  }
  function info(...args) {
    console.log(LOG_PREFIX, ...args);
  }
  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }
  function err(...args) {
    console.error(LOG_PREFIX, ...args);
  }

  // ==============================
  // Utilities
  // ==============================
  function delayRand(min, max) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getGuardKey(prefix) {
    return `${prefix}${location.pathname}${location.search}`;
  }

  function truncateText(str, max = 50) {
    if (!str) return '';
    const s = str.replace(/\s+/g, ' ').trim();
    if (s.length <= max) return s;
    return s.slice(0, max) + '...';
  }

  function normalizeText(str) {
    return (str || '').replace(/\s+/g, ' ').trim();
  }

  // Return array of issues. Empty => ok
  function getElementIssues(el, options = {}) {
    const issues = [];
    if (!el) {
      issues.push('no_element');
      return issues;
    }

    const {
      textMatchers,
      requireHrefIncludes
    } = options;

    // Visibility checks
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      issues.push('not_visible');
    }
    if (rect.width === 0 || rect.height === 0) {
      issues.push('not_visible');
    }

    // Disabled
    if (el.disabled) issues.push('disabled');
    const ariaDisabled = el.getAttribute('aria-disabled');
    if (ariaDisabled === 'true') issues.push('aria_disabled');

    // Text match
    if (textMatchers && textMatchers.length > 0) {
      const text = normalizeText(el.innerText || el.textContent || '');
      const matched = textMatchers.some((t) => text.includes(t));
      if (!matched) issues.push('text_mismatch');
    }

    // Href requirement
    if (requireHrefIncludes) {
      const href = el.getAttribute('href') || '';
      if (!href || !href.includes(requireHrefIncludes)) {
        issues.push('no_href');
      }
    }

      // ==============================
      // Phase: GCP Result (「結果をみる」)
      // ==============================
      function runGcpResultPhase() {
        const label = 'GCP_RESULT';
        state.phase = `${label}:init`;

        const guardKey = getGuardKey(GCP_RESULT_GUARD_PREFIX);

        const findFn = () => {
          const elements = document.querySelectorAll('a');
          state.lastCandidateCount = elements.length;
          const list = Array.from(elements || []);

          const textMatch = (el) => normalizeText(el.innerText || el.textContent || '').includes('結果をみる');
          const hrefMatch = (el) => (el.getAttribute('href') || '').includes('/entry/lottery/result');

          // Priority: both text + href, then href, then text
          let candidates = list.filter((el) => textMatch(el) && hrefMatch(el));
          if (candidates.length === 0) candidates = list.filter((el) => hrefMatch(el));
          if (candidates.length === 0) candidates = list.filter((el) => textMatch(el));

          if (candidates.length === 0) {
            if (DEBUG) {
              dumpCandidates(label, list, MAX_DUMP_CANDIDATES, (el) => {
                const issues = getElementIssues(el, { textMatchers: ['結果をみる'] });
                return elementInfo(el, issues);
              });
            } else {
              info(`${label}: no target found.`);
            }
            return null;
          }

          // If multiple, prefer hrefs containing 'result' or 'lottery'
          candidates.sort((a, b) => {
            const aHref = (a.getAttribute('href') || '').toLowerCase();
            const bHref = (b.getAttribute('href') || '').toLowerCase();
            const aScore = (aHref.includes('result') || aHref.includes('lottery')) ? 0 : 1;
            const bScore = (bHref.includes('result') || bHref.includes('lottery')) ? 0 : 1;
            return aScore - bScore;
          });

          // Ensure element is actionable (visible & not disabled).
          // Use appropriate validation depending on how the candidate matched (text/href/both).
          for (const el of candidates) {
            const isText = textMatch(el);
            const isHref = hrefMatch(el);
            const checkOpts = {};
            if (isText) checkOpts.textMatchers = ['結果をみる'];
            if (isHref) checkOpts.requireHrefIncludes = '/entry/lottery/result';

            const issues = getElementIssues(el, checkOpts);
            if (issues.length === 0) return el;
            if (DEBUG) {
              log(`${label}: candidate skipped`, elementInfo(el, issues));
            }
          }

          return null;
        };

        const scheduleFixed = () => {
          if (sessionStorage.getItem(guardKey)) {
            log(`${label}: guard skip`);
            return;
          }

          const found = findFn();
          if (!found) {
            info(`${label}: not found at scheduling time`);
            return;
          }

          log(`${label}: found. delay=${GCP_RESULT_DELAY_MS}ms`);

          setTimeout(() => {
            state.phase = `${label}:recheck`;
            const el = findFn();
            if (!el) {
              info(`${label}: target disappeared before click.`);
              return;
            }

            // set guard before clicking to avoid races
            sessionStorage.setItem(guardKey, Date.now().toString());
            state.phase = `${label}:click`;
            clickWithFallback(el).then((ok) => {
              info(`${label}: clicked. success=${ok}`);
              state.phase = `${label}:done`;
            });
          }, GCP_RESULT_DELAY_MS);
        };

        const initial = findFn();
        if (initial) {
          scheduleFixed();
          return;
        }

        startObserver({
          label,
          findFn,
          timeoutMs: OBSERVER_TIMEOUT_MS,
          onFound: () => {
            scheduleFixed();
          }
        });
      }

    return issues;
  }

  function findBestCandidate({ candidates, textMatchers, hrefIncludes }) {
    if (!candidates || candidates.length === 0) return null;

    // Prefer earlier matcher order
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const issues = getElementIssues(el, {
        textMatchers,
        requireHrefIncludes: hrefIncludes
      });
      if (issues.length === 0) return el;
    }
    return null;
  }

  function dumpCandidates(label, elements, maxN, inspectorFn) {
    const list = Array.from(elements || []);
    const slice = list.slice(0, maxN);

    info(`${label}: no target found. Dumping candidates (max ${maxN})...`);
    slice.forEach((el, idx) => {
      const infoObj = inspectorFn(el);
      info(`[${label}] #${idx}`, infoObj);
    });

    if (list.length > maxN) {
      info(`${label}: ${list.length - maxN} more candidates omitted`);
    }
  }

  function elementInfo(el, issues) {
    const role = el.getAttribute('role') || '';
    const className = (el.className || '').toString();
    const trimmedClass = className.length > 80 ? className.slice(0, 80) + '...' : className;
    const href = el.getAttribute('href') || '';
    const text = truncateText(el.innerText || el.textContent || '', 50);
    return {
      tagName: el.tagName,
      role,
      className: trimmedClass,
      href,
      innerText: text,
      issues
    };
  }

  async function clickWithFallback(el) {
    if (!el) return false;

    try {
      el.click();
      log('clickWithFallback: primary el.click()');
      return true;
    } catch (e1) {
      log('clickWithFallback: primary failed', e1);
    }

    try {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      log('clickWithFallback: dispatchEvent click');
      return true;
    } catch (e2) {
      log('clickWithFallback: dispatchEvent failed', e2);
    }

    try {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      log('clickWithFallback: pointerdown/up/click');
      return true;
    } catch (e3) {
      log('clickWithFallback: pointer sequence failed', e3);
    }

    return false;
  }

  function scheduleAutoClick({ label, findFn, delayMin, delayMax, guardKey }) {
    if (state.attempts >= MAX_ATTEMPTS_PER_PAGE) {
      warn(`${label}: max attempts reached (${MAX_ATTEMPTS_PER_PAGE}). Abort.`);
      return;
    }

    state.attempts += 1;
    state.phase = `${label}:scheduled`;
    state.guardKey = guardKey;

    if (sessionStorage.getItem(guardKey)) {
      info(`${label}: already guarded. skip.`);
      return;
    }

    log(`${label}: scheduling click attempt #${state.attempts}`);
    delayRand(delayMin, delayMax).then(() => {
      state.phase = `${label}:recheck`;
      const el = findFn();

      if (!el) {
        info(`${label}: target not found after delay.`);
        return;
      }

      sessionStorage.setItem(guardKey, Date.now().toString());
      state.phase = `${label}:click`;
      clickWithFallback(el).then((ok) => {
        info(`${label}: click attempted. success=${ok}`);
        state.phase = `${label}:done`;
      });
    });
  }

  function startObserver({ label, findFn, onFound, timeoutMs }) {
    const obs = new MutationObserver(() => {
      const el = findFn();
      if (el) {
        obs.disconnect();
        state.observerActive = false;
        log(`${label}: observer found target. disconnected.`);
        onFound(el);
      }
    });

    obs.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });

    state.observerActive = true;

    setTimeout(() => {
      if (state.observerActive) {
        obs.disconnect();
        state.observerActive = false;
        info(`${label}: observer timeout. disconnected.`);
      }
    }, timeoutMs);
  }

  // ==============================
  // Phase: GCP
  // ==============================
  function runGcpPhase() {
    const label = 'GCP';
    state.phase = `${label}:init`;

    const guardKey = getGuardKey(GCP_GUARD_PREFIX);

    const findFn = () => {
      const elements = document.querySelectorAll('a[href*="/authentications/auth/"]');
      state.lastCandidateCount = elements.length;

      const candidates = Array.from(elements);
      const target = findBestCandidate({
        candidates,
        textMatchers: ['参加する'],
        hrefIncludes: '/authentications/auth/'
      });

      if (!target) {
        if (DEBUG) {
          dumpCandidates(label, candidates, MAX_DUMP_CANDIDATES, (el) => {
            const issues = getElementIssues(el, {
              textMatchers: ['参加する'],
              requireHrefIncludes: '/authentications/auth/'
            });
            return elementInfo(el, issues);
          });
        } else {
          info(`${label}: no target found.`);
        }
      }

      return target;
    };

    const found = findFn();
    if (found) {
      scheduleAutoClick({
        label,
        findFn,
        delayMin: GCP_DELAY_MIN_MS,
        delayMax: GCP_DELAY_MAX_MS,
        guardKey
      });
      return;
    }

    startObserver({
      label,
      findFn,
      timeoutMs: OBSERVER_TIMEOUT_MS,
      onFound: () => {
        scheduleAutoClick({
          label,
          findFn,
          delayMin: GCP_DELAY_MIN_MS,
          delayMax: GCP_DELAY_MAX_MS,
          guardKey
        });
      }
    });
  }

  // ==============================
  // Phase: X OAuth2
  // ==============================
  function runXOAuthPhase() {
    const label = 'XOAuth';
    state.phase = `${label}:init`;

    const guardKey = getGuardKey(X_GUARD_PREFIX);

    const findFn = () => {
      const elements = document.querySelectorAll('button, div[role="button"], a[role="button"]');
      state.lastCandidateCount = elements.length;

      const candidates = Array.from(elements);

      // Prefer earlier matcher
      let target = null;
      for (const matcher of X_TEXT_MATCHERS) {
        target = candidates.find((el) => {
          const issues = getElementIssues(el, { textMatchers: [matcher] });
          return issues.length === 0;
        });
        if (target) break;
      }

      if (!target) {
        if (DEBUG) {
          dumpCandidates(label, candidates, MAX_DUMP_CANDIDATES, (el) => {
            const issues = getElementIssues(el, { textMatchers: X_TEXT_MATCHERS });
            return elementInfo(el, issues);
          });
        } else {
          info(`${label}: no target found.`);
        }
      }

      return target;
    };

    const found = findFn();
    if (found) {
      scheduleAutoClick({
        label,
        findFn,
        delayMin: X_DELAY_MIN_MS,
        delayMax: X_DELAY_MAX_MS,
        guardKey
      });
      return;
    }

    startObserver({
      label,
      findFn,
      timeoutMs: OBSERVER_TIMEOUT_MS,
      onFound: () => {
        scheduleAutoClick({
          label,
          findFn,
          delayMin: X_DELAY_MIN_MS,
          delayMax: X_DELAY_MAX_MS,
          guardKey
        });
      }
    });
  }

  // ==============================
  // Manual debug helpers
  // ==============================
  window.tmAutoClickStatus = function tmAutoClickStatus() {
    return {
      phase: state.phase,
      attempts: state.attempts,
      guardKey: state.guardKey,
      guardHit: state.guardKey ? !!sessionStorage.getItem(state.guardKey) : false,
      lastCandidateCount: state.lastCandidateCount,
      observerActive: state.observerActive,
      lastError: state.lastError
    };
  };

  window.tmAutoClickRun = function tmAutoClickRun(options = {}) {
    const { force = false } = options;
    if (state.guardKey && sessionStorage.getItem(state.guardKey) && !force) {
      info('tmAutoClickRun: guarded. use {force:true} to bypass when DEBUG=true');
      return;
    }
    if (force && !DEBUG) {
      info('tmAutoClickRun: force ignored because DEBUG=false');
      return;
    }

    info('tmAutoClickRun: manual trigger');
    main(true);
  };

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'j') {
      window.tmAutoClickRun({ force: DEBUG });
    }
  });

  // ==============================
  // Main
  // ==============================
  function main(isManual = false) {
    try {
      state.phase = 'main';
      state.attempts = 0;
      state.lastError = null;
      state.lastCandidateCount = 0;

      const host = location.host;

      if (host === 'gcp.giftee.biz') {
        runGcpPhase();
        runGcpResultPhase();
        return;
      }

      if (host === 'x.com') {
        const okPath = location.pathname === '/i/oauth2/authorize';
        const hasClientId = new URLSearchParams(location.search).has('client_id');
        if (okPath && hasClientId) {
          runXOAuthPhase();
        } else {
          log('X: path or client_id not matched, skip.');
        }
        return;
      }

      log('No matching host. skip.');
    } catch (e) {
      state.lastError = e;
      if (DEBUG) {
        err('Unhandled error:', e, e.stack);
      } else {
        err('Unhandled error:', e.message || e);
      }
    } finally {
      if (isManual) {
        log('Manual run completed.');
      }
    }
  }

  main(false);
})();
