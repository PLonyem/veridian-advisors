/**
 * Veridian Global Advisors — Global JS
 * Progressive enhancement: every feature below layers on top of markup that
 * already works without it. If this file 404s, fails to parse, or the
 * browser doesn't support something it needs, the page must not break.
 *
 * Expected markup this file enhances (documented once here, since there's no
 * HTML in this repo yet to read it off of):
 *
 *   <form id="intake-form" method="POST" action="/api/submit-lead">
 *     <input name="fullName" required>
 *     <input name="country" required>
 *     <select name="netWorth" required>...</select>
 *     <select name="tierInterest" required>...</select>
 *     <input name="email" type="email" required>
 *     <input name="disclaimerAccepted" type="checkbox" required>
 *     <div id="form-message" class="form-error" role="alert" hidden></div>
 *     <button type="submit" class="btn btn--primary">Submit</button>
 *   </form>
 *
 *   <button class="nav__toggle" aria-expanded="false" aria-controls="primary-nav">
 *     <span class="nav__toggle-bar"></span>
 *     <span class="nav__toggle-bar"></span>
 *     <span class="nav__toggle-bar"></span>
 *   </button>
 *   <nav id="primary-nav" class="nav__menu is-mobile">...</nav>
 *
 *   <img class="lazy-image" src="placeholder.jpg" data-src="real.jpg" alt="…">
 *   <noscript><img src="real.jpg" alt="…"></noscript>
 *
 *   <div class="scroll-progress" aria-hidden="true"><div class="scroll-progress__bar"></div></div>
 *   (optional per page - only runs if present; a fixed bar across the top
 *   of the viewport that fills as the reader scrolls down.)
 *
 *   <span data-counter="7500" data-counter-prefix="$">7,500</span>
 *   (optional, any number of these - animates the element's text counting
 *   up to data-counter once it scrolls into view. The static text content
 *   should already be the real final value, so nothing regresses if this
 *   script never runs. data-counter-suffix and data-counter-duration [ms,
 *   default 1200] are both optional too.)
 *
 *   <details class="faq-item">
 *     <summary>Question</summary>
 *     <div class="faq-item__answer"><p>Answer</p></div>
 *   </details>
 *   (any number of these - gets a smooth open/close height transition on
 *   top of the native <details> instant toggle.)
 *
 * That <noscript> tag isn't decorative - it's required for real progressive
 * enhancement here. The `.lazy-image` class carries a permanent CSS blur
 * (see style.css) that only gets removed once this script swaps data-src
 * into src. If JS is disabled outright (not just missing
 * IntersectionObserver - this file's IO fallback DOES handle that case),
 * nothing ever removes it, and `src="placeholder.jpg"` never becomes the
 * real image. The <noscript> tag renders its own plain <img> instead in
 * that case, bypassing the lazy-load markup entirely.
 *
 * IMPORTANT — a real gap this revealed, not fixed here (out of scope for a
 * JS-only file, and it'd change an already-tested backend contract): the
 * backend's disclaimer check is `disclaimer_accepted !== true` (a strict
 * boolean). A vanilla HTML checkbox submitted via a no-JS <form> POST can
 * only ever send the string "on" (checked) or omit the field entirely
 * (unchecked) — never a real boolean. That means the <noscript> fallback
 * path (form action="/api/submit-lead", no JS) will ALWAYS get rejected
 * with "You must accept the disclaimer", even when the box is checked.
 * Everything else in the form degrades correctly without JS; this one field
 * doesn't, and fixing it requires a backend change (accept "on"/"true" as
 * well as boolean true), not just something we can do here of the client.
 */
(function () {
  'use strict';

  // Feature detection - bail out of anything a browser doesn't support
  // rather than throwing and breaking everything after it. Every init*
  // function below is independent, so one missing API only disables its
  // own feature, not the whole file.
  var supportsIntersectionObserver = 'IntersectionObserver' in window;
  var supportsFetch = 'fetch' in window;
  var prefersReducedMotion =
    'matchMedia' in window && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     Utilities
     ------------------------------------------------------------------ */

  /**
   * Debounces a function so it only runs `wait` ms after the last call.
   * Used for scroll/resize handlers so we're not doing work on every
   * single event - a scroll can fire dozens of times per second.
   */
  function debounce(fn, wait) {
    var timeoutId;
    return function debounced() {
      var context = this;
      var args = arguments;
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(function () {
        fn.apply(context, args);
      }, wait);
    };
  }

  function scrollToTarget(target) {
    target.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  /* ------------------------------------------------------------------
     Form Handling
     ------------------------------------------------------------------ */

  // Mirrors src/utils/validators.js exactly, so a field that passes here
  // will also pass on the server - no "client says fine, server rejects"
  // surprises.
  var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var FIELD_VALIDATORS = {
    fullName: function (value) {
      var trimmed = value.trim();
      if (!trimmed) return 'Full name is required.';
      if (trimmed.length < 2) return 'Full name must be at least 2 characters.';
      return '';
    },
    country: function (value) {
      var trimmed = value.trim();
      if (!trimmed) return 'Country is required.';
      if (trimmed.length < 2) return 'Country must be at least 2 characters.';
      return '';
    },
    netWorth: function (value) {
      return value ? '' : 'Please select a net worth range.';
    },
    tierInterest: function (value) {
      return value ? '' : 'Please select a tier of interest.';
    },
    email: function (value) {
      var trimmed = value.trim();
      if (!trimmed) return 'Email is required.';
      if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address.';
      return '';
    },
  };

  function initFormHandling() {
    var form = document.getElementById('intake-form');
    if (!form) return;

    // Cache every selector we need once, up front, instead of re-querying
    // the DOM inside event handlers.
    var submitButton = form.querySelector('button[type="submit"]');
    var disclaimerInput = form.querySelector('[name="disclaimerAccepted"]');
    var messageBox = document.getElementById('form-message');
    var originalButtonText = submitButton ? submitButton.textContent : '';
    var isSubmitting = false;

    var fields = {};
    Object.keys(FIELD_VALIDATORS).forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      if (input) fields[name] = input;
    });

    function errorElementFor(input) {
      var id = input.id || input.name;
      return form.querySelector('#' + id + '-error');
    }

    function setFieldError(input, message) {
      var errorEl = errorElementFor(input);
      if (message) {
        input.setAttribute('aria-invalid', 'true');
        if (errorEl) errorEl.textContent = message;
      } else {
        input.removeAttribute('aria-invalid');
        if (errorEl) errorEl.textContent = '';
      }
    }

    function validateField(name) {
      var input = fields[name];
      if (!input) return true;
      var message = FIELD_VALIDATORS[name](input.value);
      setFieldError(input, message);
      return !message;
    }

    function validateAll() {
      var allValid = true;
      Object.keys(fields).forEach(function (name) {
        if (!validateField(name)) allValid = false;
      });
      if (disclaimerInput && !disclaimerInput.checked) {
        setFieldError(disclaimerInput, 'You must accept the disclaimer.');
        allValid = false;
      } else if (disclaimerInput) {
        setFieldError(disclaimerInput, '');
      }
      return allValid;
    }

    // Real-time validation: validate on blur (so we're not yelling
    // "required!" while someone's still mid-typing their first
    // keystroke), then keep re-validating on every subsequent input once
    // a field has shown an error, so the message clears the moment it's
    // fixed instead of lingering until the next blur.
    Object.keys(fields).forEach(function (name) {
      var input = fields[name];
      input.addEventListener('blur', function () {
        validateField(name);
      });
      input.addEventListener('input', function () {
        if (input.getAttribute('aria-invalid') === 'true') {
          validateField(name);
        }
      });
    });

    if (disclaimerInput) {
      disclaimerInput.addEventListener('change', function () {
        if (disclaimerInput.checked) setFieldError(disclaimerInput, '');
      });
    }

    function showFormMessage(text) {
      if (!messageBox) {
        // No dedicated message region in the markup - fall back to an
        // alert rather than silently swallowing the error.
        if (text) window.alert(text);
        return;
      }
      messageBox.textContent = text;
      messageBox.hidden = !text;
    }

    function setLoading(loading) {
      if (!submitButton) return;
      submitButton.disabled = loading;
      submitButton.classList.toggle('is-loading', loading);
      submitButton.setAttribute('aria-busy', loading ? 'true' : 'false');
    }

    function showSuccess() {
      if (!submitButton) return;
      submitButton.classList.remove('is-loading');
      submitButton.classList.add('is-success');
      submitButton.textContent = 'Submitted';
    }

    function resetButton() {
      if (!submitButton) return;
      // Routes through setLoading(false) rather than duplicating a subset of
      // it inline, so aria-busy is reset along with disabled/is-loading -
      // it was previously left stuck at "true" after a failed submission,
      // even though the button was interactive again.
      setLoading(false);
      submitButton.classList.remove('is-success');
      submitButton.textContent = originalButtonText;
    }

    form.addEventListener('submit', function (event) {
      // No fetch support (very old browser) - let the <form>'s own
      // method="POST" action="/api/submit-lead" handle it natively. The
      // server accepts both JSON and urlencoded bodies, so this works
      // (see the disclaimer-checkbox caveat at the top of this file).
      if (!supportsFetch) return;

      event.preventDefault();

      // Guard against double submission from a double-click or a second
      // Enter-key press landing before `disabled` takes visual effect.
      if (isSubmitting) return;

      showFormMessage('');
      if (!validateAll()) {
        var firstInvalid = form.querySelector('[aria-invalid="true"]');
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      isSubmitting = true;
      setLoading(true);

      var formData = new FormData(form);
      var data = Object.fromEntries(formData.entries());
      data.disclaimerAccepted = data.disclaimerAccepted === 'on';

      fetch(form.getAttribute('action') || '/api/submit-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              return { ok: response.ok, status: response.status, body: body };
            });
        })
        .then(function (result) {
          if (result.ok) {
            showSuccess();
            window.setTimeout(function () {
              window.location.href = '/thank-you.html';
            }, 800);
            return;
          }

          if (result.status === 429) {
            showFormMessage(result.body.message || 'Too many attempts. Please try again later.');
          } else if (result.body && Array.isArray(result.body.details)) {
            showFormMessage(result.body.details.join(' '));
          } else if (result.body && result.body.error) {
            showFormMessage(result.body.error);
          } else {
            showFormMessage('Something went wrong. Please try again.');
          }

          isSubmitting = false;
          resetButton();
        })
        .catch(function (error) {
          console.error('Network error submitting lead form:', error);
          showFormMessage('Network error. Please check your connection and try again.');
          isSubmitting = false;
          resetButton();
        });
    });
  }

  /* ------------------------------------------------------------------
     Navigation
     ------------------------------------------------------------------ */

  function initNavigation() {
    var nav = document.querySelector('.nav');
    var toggle = document.querySelector('.nav__toggle');
    var menu = document.querySelector('.nav__menu');
    var navLinks = document.querySelectorAll('.nav__link');
    var FOCUSABLE_SELECTOR = 'a[href], button:not([disabled])';

    function openMobileMenu() {
      menu.classList.add('is-open');
      if (toggle) {
        toggle.classList.add('is-open');
        toggle.setAttribute('aria-expanded', 'true');
      }
      // Prevent the page scrolling behind an open full-screen mobile menu.
      document.body.style.overflow = 'hidden';
      // Move focus into the menu so keyboard/screen-reader users land
      // somewhere meaningful, rather than staying on a now-hidden-behind-
      // the-overlay toggle button.
      var firstLink = menu.querySelector(FOCUSABLE_SELECTOR);
      if (firstLink) firstLink.focus();
    }

    function closeMobileMenu(options) {
      if (!menu || !menu.classList.contains('is-open')) return;
      menu.classList.remove('is-open');
      if (toggle) {
        toggle.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
      document.body.style.overflow = '';
      // Only return focus to the toggle for interactions that don't already
      // move focus somewhere else on their own (Escape; the toggle button
      // itself) - a same-page anchor link click, for instance, is about to
      // send focus to its destination section instead.
      if (options && options.returnFocus && toggle) {
        toggle.focus();
      }
    }

    // Mobile hamburger menu
    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        if (menu.classList.contains('is-open')) {
          closeMobileMenu({ returnFocus: true });
        } else {
          openMobileMenu();
        }
      });

      // Escape closes the menu and returns focus to the toggle, same as
      // dismissing any other transient overlay.
      menu.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          closeMobileMenu({ returnFocus: true });
          return;
        }

        // Simple focus trap: while the menu is open (mobile breakpoint
        // only - see is-mobile in style.css), Tab should cycle within it
        // rather than escaping to content underneath the overlay.
        if (event.key === 'Tab') {
          var focusable = Array.prototype.slice.call(menu.querySelectorAll(FOCUSABLE_SELECTOR));
          if (!focusable.length) return;
          var first = focusable[0];
          var last = focusable[focusable.length - 1];

          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      });
    }

    // Sticky header: add a blurred background once the page has scrolled
    // past the top. Debounced (short delay) so this isn't recalculated on
    // every single scroll tick, just settled bursts of them.
    if (nav) {
      var updateScrolledState = debounce(function () {
        nav.classList.toggle('is-scrolled', window.scrollY > 24);
      }, 10);
      window.addEventListener('scroll', updateScrolledState, { passive: true });
      updateScrolledState();
    }

    // Active link highlighting for same-page section links (#id hrefs).
    // Uses IntersectionObserver instead of computing scroll math by hand.
    if (supportsIntersectionObserver && navLinks.length) {
      var linksBySectionId = {};
      navLinks.forEach(function (link) {
        var href = link.getAttribute('href') || '';
        if (href.charAt(0) === '#' && href.length > 1) {
          linksBySectionId[href.slice(1)] = link;
        }
      });

      var sectionIds = Object.keys(linksBySectionId);
      if (sectionIds.length) {
        var sectionObserver = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              var link = linksBySectionId[entry.target.id];
              if (!link) return;
              link.classList.toggle('is-active', entry.isIntersecting);
            });
          },
          { rootMargin: '-40% 0px -55% 0px' }
        );

        sectionIds.forEach(function (id) {
          var section = document.getElementById(id);
          if (section) sectionObserver.observe(section);
        });
      }
    }

    // Active link highlighting for regular multi-page navigation: mark
    // whichever nav link points at the current page.
    navLinks.forEach(function (link) {
      if (link.pathname === window.location.pathname && link.pathname !== '/') {
        link.classList.add('is-active');
      }
    });

    // Smooth scroll for on-page anchor links, closing the mobile menu
    // first if it was open (otherwise it stays open over the destination).
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (event) {
        var href = anchor.getAttribute('href');
        if (!href || href === '#') return;
        var target = document.querySelector(href);
        if (!target) return;
        event.preventDefault();
        closeMobileMenu();
        scrollToTarget(target);
      });
    });
  }

  /* ------------------------------------------------------------------
     Scroll Animations
     ------------------------------------------------------------------ */

  function initScrollReveal() {
    var revealEls = document.querySelectorAll('.reveal');
    if (!revealEls.length) return;

    if (!supportsIntersectionObserver) {
      // No IO support: reveal everything immediately rather than leaving
      // it permanently invisible (opacity: 0 in the CSS with no fallback
      // would otherwise hide this content forever in that browser).
      revealEls.forEach(function (el) {
        el.classList.add('is-visible');
      });
      return;
    }

    // Staggered card animations: elements that share a parent get an
    // increasing transition-delay based on their order among reveal
    // siblings, so a row/grid of cards cascades in rather than all
    // appearing at once. Computed once up front, not on every observer
    // callback.
    var staggerCounters = new Map();
    revealEls.forEach(function (el) {
      var parent = el.parentElement;
      var index = staggerCounters.get(parent) || 0;
      el.style.transitionDelay = Math.min(index * 90, 450) + 'ms';
      staggerCounters.set(parent, index + 1);
    });

    var revealObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target); // animates in once, not every scroll
          }
        });
      },
      { threshold: 0.15 }
    );

    revealEls.forEach(function (el) {
      revealObserver.observe(el);
    });
  }

  /**
   * Runs `fn` at most once per animation frame no matter how often it's
   * called, by using a boolean flag rather than clearTimeout/setTimeout.
   * Used for scroll handlers that drive a continuous visual update (parallax,
   * the scroll-progress bar) - a bar/offset that visibly steps every 100ms+
   * feels laggy, so this rides the frame clock instead of a fixed delay.
   * (Contrast with `debounce` above: that's for state that only needs to
   * settle eventually, like the nav's scrolled/not-scrolled boolean.)
   */
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

  // Subtle parallax on each page's decorative hero background pattern: it
  // scrolls slightly slower than the page, which reads as depth rather than
  // motion. Skipped entirely under prefers-reduced-motion, since scroll-
  // linked transform movement is exactly the kind of effect that setting is
  // meant to suppress (unlike the reveal/fade animations above, which just
  // become instant rather than being removed).
  function initParallax() {
    if (prefersReducedMotion) return;

    var targets = document.querySelectorAll('.hero__bg-pattern, .page-hero__bg-pattern');
    if (!targets.length) return;

    var updatePositions = rafThrottle(function () {
      var offset = window.scrollY;
      targets.forEach(function (el) {
        el.style.transform = 'translateY(' + offset * 0.12 + 'px)';
      });
    });

    window.addEventListener('scroll', updatePositions, { passive: true });
  }

  /* ------------------------------------------------------------------
     Number counters
     ------------------------------------------------------------------ */

  /**
   * Animates `el`'s text from 0 up to `target` over `duration` ms, using
   * requestAnimationFrame with a real elapsed-time calculation (rather than
   * a fixed setInterval tick) so the count rate stays smooth regardless of
   * how fast the browser can actually run the callback. Reads an optional
   * data-counter-prefix / data-counter-suffix off `el` (e.g. "$" / "+"), and
   * formats the number with thousands separators via toLocaleString.
   */
  function animateCounter(el, target, duration) {
    var prefix = el.getAttribute('data-counter-prefix') || '';
    var suffix = el.getAttribute('data-counter-suffix') || '';

    function render(value) {
      el.textContent = prefix + Math.round(value).toLocaleString('en-US') + suffix;
    }

    if (prefersReducedMotion) {
      render(target);
      return;
    }

    var startTime = null;
    function step(timestamp) {
      if (startTime === null) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);
      render(progress * target);
      if (progress < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  // Counts up any [data-counter] element to its target value once it
  // scrolls into view, rather than on page load where the user might not
  // even be looking at it yet. Applied to real, already-published figures
  // (e.g. pricing.html's tier fees) - nothing here invents a number that
  // isn't already elsewhere on the page as static text.
  function initCounters() {
    var counters = document.querySelectorAll('[data-counter]');
    if (!counters.length) return;

    if (!supportsIntersectionObserver) {
      counters.forEach(function (el) {
        animateCounter(el, parseFloat(el.getAttribute('data-counter'), 10), 0);
      });
      return;
    }

    var counterObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var target = parseFloat(el.getAttribute('data-counter'), 10);
          var duration = parseInt(el.getAttribute('data-counter-duration'), 10) || 1200;
          if (!isNaN(target)) animateCounter(el, target, duration);
          observer.unobserve(el);
        });
      },
      { threshold: 0.6 }
    );

    counters.forEach(function (el) {
      counterObserver.observe(el);
    });
  }

  /* ------------------------------------------------------------------
     Scroll progress bar
     ------------------------------------------------------------------ */

  // Fills a fixed bar across the top of the viewport as the reader scrolls
  // through the page. Opt-in via markup (only runs if the element exists),
  // rather than always injecting one - see the pages that include
  // <div class="scroll-progress">.
  function initScrollProgress() {
    var bar = document.querySelector('.scroll-progress__bar');
    if (!bar) return;

    var update = rafThrottle(function () {
      var scrollable = document.documentElement.scrollHeight - window.innerHeight;
      var progress = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
      bar.style.width = progress + '%';
    });

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', debounce(update, 100));
    update();
  }

  /* ------------------------------------------------------------------
     FAQ accordion
     ------------------------------------------------------------------ */

  // Smooth height animation on top of native <details>/<summary>. Shared
  // sitewide (pricing.html's FAQ preview and faq.html's full list both use
  // the same .faq-item markup) rather than duplicated per page. If this
  // never runs, clicking still opens/closes each item instantly via the
  // browser's native <details> behavior - this only adds the transition.
  function initFAQAccordion() {
    var items = document.querySelectorAll('.faq-item');

    items.forEach(function (item) {
      var summary = item.querySelector('summary');
      var answer = item.querySelector('.faq-item__answer');
      if (!summary || !answer) return;

      summary.addEventListener('click', function (event) {
        event.preventDefault();

        if (item.hasAttribute('open')) {
          // Closing: fix the current rendered height, then transition to 0.
          answer.style.height = answer.scrollHeight + 'px';
          // Force layout so the browser registers the starting height
          // before the next line changes it - otherwise both writes can
          // get batched together and there's nothing to transition from.
          // eslint-disable-next-line no-unused-expressions
          answer.offsetHeight;
          answer.style.height = '0px';

          answer.addEventListener('transitionend', function onEnd() {
            item.removeAttribute('open');
            answer.style.height = '';
            answer.removeEventListener('transitionend', onEnd);
          });
        } else {
          // Opening: <details> must be [open] for scrollHeight to reflect
          // the answer's natural size, so set that first, then animate
          // from 0 up to the now-measurable height.
          item.setAttribute('open', '');
          answer.style.height = '0px';
          var targetHeight = answer.scrollHeight;

          window.requestAnimationFrame(function () {
            answer.style.height = targetHeight + 'px';
          });

          answer.addEventListener('transitionend', function onEnd() {
            answer.style.height = '';
            answer.removeEventListener('transitionend', onEnd);
          });
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     Button ripple effect
     ------------------------------------------------------------------ */

  // Material-style expanding-circle click feedback on every .btn. Purely
  // decorative - doesn't call preventDefault or interfere with the
  // element's real click behavior (form submit, navigation, etc.), and the
  // animation itself is neutralized automatically for
  // prefers-reduced-motion by style.css's global `* { animation-duration:
  // 0.01ms }` override, same as every other CSS-driven animation on the
  // site.
  function initRippleEffect() {
    document.querySelectorAll('.btn').forEach(function (btn) {
      btn.addEventListener('click', function (event) {
        var rect = btn.getBoundingClientRect();
        // event.clientX/Y are 0 for a keyboard-triggered click (Enter/Space) -
        // fall back to the button's center so the ripple still looks
        // intentional rather than bursting from a corner.
        var originX = event.clientX || rect.left + rect.width / 2;
        var originY = event.clientY || rect.top + rect.height / 2;
        var size = Math.max(rect.width, rect.height) * 2;

        var ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = originX - rect.left - size / 2 + 'px';
        ripple.style.top = originY - rect.top - size / 2 + 'px';

        btn.appendChild(ripple);
        ripple.addEventListener('animationend', function () {
          ripple.remove();
        });
      });
    });
  }

  /* ------------------------------------------------------------------
     Lazy-loaded images
     ------------------------------------------------------------------ */

  function initLazyImages() {
    var lazyImages = document.querySelectorAll('img.lazy-image[data-src]');
    if (!lazyImages.length) return;

    function loadImage(img) {
      if (img.dataset.src) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
      }
      if (img.dataset.srcset) {
        img.srcset = img.dataset.srcset;
        img.removeAttribute('data-srcset');
      }
      img.classList.remove('lazy-image');
      img.classList.add('lazy-image--loaded');
    }

    if (!supportsIntersectionObserver) {
      // No IO support: load everything up front. Not ideal for
      // performance, but correct - better than images that never appear.
      lazyImages.forEach(loadImage);
      return;
    }

    var imageObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            loadImage(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '200px 0px' } // start loading a little before it's on screen
    );

    lazyImages.forEach(function (img) {
      imageObserver.observe(img);
    });
  }

  /* ------------------------------------------------------------------
     Init
     ------------------------------------------------------------------ */

  function init() {
    initFormHandling();
    initNavigation();
    initScrollReveal();
    initParallax();
    initCounters();
    initScrollProgress();
    initFAQAccordion();
    initRippleEffect();
    initLazyImages();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOMContentLoaded already fired (e.g. this script has `defer` and ran
    // late) - just run init directly instead of waiting for an event that
    // already happened.
    init();
  }
})();
