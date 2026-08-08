/**
 * How It Works — process timeline interactivity.
 * Independent of js/main.js: the timeline markers are plain `<a href="#phase-N">`
 * anchors, so main.js's existing smooth-scroll click handler already handles
 * navigation for them (and works with no JS at all, via native anchor jump).
 * This file only *adds* two enhancements on top, each independently optional:
 * a brief highlight pulse on the phase jumped to, and scroll-spy "active"
 * state on the marker whose phase is currently in view.
 */
(function () {
  'use strict';

  function initProcessTimeline() {
    var markers = document.querySelectorAll('.process-timeline__marker');
    if (!markers.length) return;

    var markersByPhaseId = {};

    markers.forEach(function (marker) {
      var href = marker.getAttribute('href') || '';
      if (href.charAt(0) !== '#' || href.length < 2) return;
      var phaseId = href.slice(1);
      markersByPhaseId[phaseId] = marker;

      marker.addEventListener('click', function () {
        var target = document.getElementById(phaseId);
        if (!target) return;
        target.classList.add('is-jumped-to');
        window.setTimeout(function () {
          target.classList.remove('is-jumped-to');
        }, 1400);
      });
    });

    if (!('IntersectionObserver' in window)) return;

    var phaseIds = Object.keys(markersByPhaseId);
    if (!phaseIds.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var marker = markersByPhaseId[entry.target.id];
          if (marker) marker.classList.toggle('is-active', entry.isIntersecting);
        });
      },
      { rootMargin: '-35% 0px -55% 0px' }
    );

    phaseIds.forEach(function (id) {
      var section = document.getElementById(id);
      if (section) observer.observe(section);
    });
  }

  function init() {
    initProcessTimeline();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
