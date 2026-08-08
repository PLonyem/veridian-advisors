/**
 * Legal page — table-of-contents scroll-spy.
 * The TOC links are plain `<a href="#section">` anchors, so navigation and
 * smooth scrolling already work via js/main.js (and via native anchor jump
 * with no JS at all). This file only adds "which section am I reading"
 * active-state highlighting on top.
 *
 * Deliberately NOT using IntersectionObserver's isIntersecting the way
 * js/main.js and js/how-it-works.js do for their (short, roughly
 * viewport-height) sections: this page's sections are dense legal text,
 * often several viewport-heights tall, so two adjacent tall sections can
 * simultaneously overlap a narrow "trigger band" near the top of the
 * viewport - whichever appears first in the DOM then wins regardless of
 * which one you're actually reading. Instead, on scroll we find the section
 * whose top has most recently crossed a fixed reading line, by comparing
 * getBoundingClientRect().top across all of them - correct regardless of
 * how tall any individual section is.
 */
(function () {
  'use strict';

  var READING_LINE = 150; // px from top of viewport

  function debounce(fn, wait) {
    var timeoutId;
    return function debounced() {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(fn, wait);
    };
  }

  function initLegalToc() {
    var links = document.querySelectorAll('.legal-toc__link');
    if (!links.length) return;

    var sections = [];
    links.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      if (href.charAt(0) !== '#' || href.length < 2) return;
      var section = document.getElementById(href.slice(1));
      if (section) sections.push({ link: link, section: section });
    });

    if (!sections.length) return;

    function updateActive() {
      var current = null;

      sections.forEach(function (entry) {
        var top = entry.section.getBoundingClientRect().top;
        if (top <= READING_LINE && (!current || top > current.top)) {
          current = { link: entry.link, top: top };
        }
      });

      sections.forEach(function (entry) {
        entry.link.classList.toggle('is-active', Boolean(current) && current.link === entry.link);
      });
    }

    window.addEventListener('scroll', debounce(updateActive, 50), { passive: true });
    window.addEventListener('resize', debounce(updateActive, 100));
    updateActive();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLegalToc);
  } else {
    initLegalToc();
  }
})();
