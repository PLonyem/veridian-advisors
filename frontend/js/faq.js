/**
 * FAQ page — search + category filtering, and the "back to top" button.
 * The accordion's smooth expand/collapse is handled globally by
 * js/main.js's initFAQAccordion() now (it's shared with pricing.html's FAQ
 * preview, which uses the same .faq-item markup) - this file only adds
 * what's specific to the full FAQ page. Everything here is progressive
 * enhancement on top of markup that already works without it:
 *   - Every FAQ item is visible by default - if the search/filter JS never
 *     runs, nothing is ever hidden, so the content is always reachable.
 *   - The "back to top" link points at #top and works via plain anchor
 *     navigation (enhanced with smooth scroll by js/main.js) even if this
 *     file's show/hide-on-scroll behavior doesn't run.
 */
(function () {
  'use strict';

  // Throttles a scroll-driven visual update to once per animation frame,
  // matching the pattern js/main.js uses for its own scroll handlers.
  function rafThrottle(fn) {
    var ticking = false;
    return function throttled() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        fn();
        ticking = false;
      });
    };
  }

  /* ------------------------------------------------------------------
     Search + category filtering
     ------------------------------------------------------------------ */
  function initFilters() {
    var searchInput = document.getElementById('faq-search-input');
    var categoryButtons = document.querySelectorAll('.faq-category-btn');
    var groups = document.querySelectorAll('.faq-group');
    var emptyState = document.querySelector('.faq-empty-state');
    if (!groups.length) return;

    var activeCategory = 'all';

    function applyFilters() {
      var query = searchInput ? searchInput.value.trim().toLowerCase() : '';
      var anyVisible = false;

      groups.forEach(function (group) {
        var groupCategory = group.getAttribute('data-category');
        var categoryMatches = activeCategory === 'all' || activeCategory === groupCategory;
        var groupHasVisibleItem = false;

        group.querySelectorAll('.faq-item').forEach(function (item) {
          var text = (item.getAttribute('data-search') || item.textContent || '').toLowerCase();
          var searchMatches = !query || text.indexOf(query) !== -1;
          var itemVisible = categoryMatches && searchMatches;
          item.classList.toggle('is-hidden', !itemVisible);
          if (itemVisible) groupHasVisibleItem = true;
        });

        group.classList.toggle('is-hidden', !groupHasVisibleItem);
        if (groupHasVisibleItem) anyVisible = true;
      });

      if (emptyState) emptyState.classList.toggle('is-visible', !anyVisible);
    }

    if (searchInput) {
      searchInput.addEventListener('input', applyFilters);
    }

    categoryButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        activeCategory = button.getAttribute('data-category') || 'all';
        categoryButtons.forEach(function (b) {
          b.classList.toggle('is-active', b === button);
          b.setAttribute('aria-pressed', b === button ? 'true' : 'false');
        });
        applyFilters();
      });
    });
  }

  /* ------------------------------------------------------------------
     Back to top
     ------------------------------------------------------------------ */
  function initBackToTop() {
    var button = document.querySelector('.back-to-top');
    if (!button) return;

    function updateVisibility() {
      button.classList.toggle('is-visible', window.scrollY > 600);
    }

    window.addEventListener('scroll', rafThrottle(updateVisibility), { passive: true });
    updateVisibility();
  }

  function init() {
    initFilters();
    initBackToTop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
