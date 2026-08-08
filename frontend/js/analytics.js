/**
 * Core Web Vitals reporting to GA4. Loads the `web-vitals` library from a
 * CDN at runtime (this project has no bundler/npm install step for the
 * frontend) and sends each metric as a GA4 event once it's available.
 *
 * No-ops entirely, silently, if:
 *   - gtag was never configured (see the <head> snippet in every page) -
 *     this happens by default, since G-XXXXXXXXXX there is a placeholder.
 *     Replace it with a real GA4 measurement ID to activate tracking.
 *   - the CDN import fails (network blocked, ad-blocker, offline).
 * Either way this must never be able to break the page - it's monitoring,
 * not a feature anything else here depends on.
 *
 * Uses INP, not FID: Google deprecated First Input Delay in favor of
 * Interaction to Next Paint as the responsiveness Core Web Vital in March
 * 2024, and current web-vitals versions no longer ship onFID. INP's "good"
 * threshold is <200ms (not the older FID <100ms figure) - it measures the
 * same class of thing (how responsive the page feels to interaction) but
 * isn't a like-for-like number swap.
 */
(function () {
  'use strict';

  if (typeof window.gtag !== 'function') return;

  import('https://unpkg.com/web-vitals@4/dist/web-vitals.attribution.js?module')
    .then(function (webVitals) {
      function sendToGA(metric) {
        window.gtag('event', metric.name, {
          // CLS has no natural "ms" unit - the *1000 trick is Google's own
          // recommended convention for representing it as a GA4 integer event value.
          value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
          metric_id: metric.id,
          metric_value: metric.value,
          metric_delta: metric.delta,
          metric_rating: metric.rating, // 'good' | 'needs-improvement' | 'poor'
        });
      }

      webVitals.onLCP(sendToGA);
      webVitals.onCLS(sendToGA);
      webVitals.onINP(sendToGA);
      webVitals.onTTFB(sendToGA);
      webVitals.onFCP(sendToGA);
    })
    .catch(function () {
      // CDN unreachable or blocked - fail silently, this is non-critical.
    });
})();
