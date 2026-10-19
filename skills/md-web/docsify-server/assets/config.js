/* Docsify configuration + route guard for the MD Web viewer.
 *
 * This lives in its own file instead of an inline <script> in index.html so the
 * page can run under a Content-Security-Policy that leaves 'unsafe-inline' out
 * of script-src. That is the part that matters: a rendered Markdown document is
 * inserted as HTML, so raw HTML in a document can carry an inline <script>, an
 * onerror= handler or a javascript: URL — all of which need 'unsafe-inline' and
 * are therefore refused by the policy.
 *
 * It also has to load *before* docsify.min.js, so that the guard has already
 * rewritten a hostile location.hash by the time docsify reads the route for the
 * first time. assets/ URLs get a ?v=<hash> stamp at deploy time, so this file is
 * re-fetched whenever the bundle changes.
 */
(function () {
  "use strict";

  // Every document this skill uploads lives under this key prefix in the bucket.
  var DOC_PREFIX = "/md-web/";

  /* A document route comes from the URL fragment, i.e. from a link that anyone
   * can be sent. Docsify treats a route containing ":" or "//" as a remote URL
   * and fetches it with XMLHttpRequest, and the renderer does not sanitize what
   * comes back — so a CORS-permitting host could otherwise supply the Markdown
   * that renders on this origin. Accept only same-origin paths under md-web/,
   * plus the landing page, and refuse everything else. */
  function isDocRoute(route) {
    var raw = String(route == null ? "" : route).replace(/^#/, "").split("?")[0];
    if (raw === "" || raw === "/" || raw === "/index.html") return true;
    if (raw.charAt(0) !== "/") return false;
    // Any scheme (http:, javascript:, data:) or a protocol-relative //host/path.
    if (/[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
    if (raw.indexOf("//") !== -1) return false;

    var decoded;
    try {
      decoded = decodeURIComponent(raw);
    } catch (e) {
      return false; // malformed percent-encoding
    }
    // Checked again after decoding: %2e%2e/ and %5c only become traversal and a
    // backslash here, and the checks above never saw them.
    if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return false;
    if (decoded.indexOf("//") !== -1) return false;
    if (decoded.split("/").indexOf("..") !== -1) return false;
    return decoded.indexOf(DOC_PREFIX) === 0;
  }

  function landingUrl() {
    return location.pathname + location.search + "#/";
  }

  // First load: correct the hash before docsify parses it. replaceState keeps the
  // crafted URL out of the address bar without adding a history entry.
  if (!isDocRoute(location.hash)) {
    history.replaceState(null, "", landingUrl());
  }

  // Later navigations (a link inside a document, a hand-edited hash) go through
  // the same check. This listener is registered first because config.js loads
  // first, so it runs before docsify's own hashchange handler starts the fetch.
  window.addEventListener("hashchange", function () {
    if (!isDocRoute(location.hash)) {
      location.replace(landingUrl());
    }
  });

  window.$docsify = {
    name: "<p>MD Web</p>",
    nameLink: "/index.html#/",
    repo: "https://github.com/rockbenben/aishort-skills/tree/main/skills/md-web",
    notFoundPage: "README.md",
    auto2top: true,

    loadNavbar: false,
    mergeNavbar: true,
    topMargin: 40,

    loadSidebar: false,

    maxLevel: 4,
    subMaxLevel: 2,

    search: {
      // 0, not a day: the index is keyed per path, and md-web serves one document
      // per link. A cached index means the next document a reader opens is searched
      // against the previous one's content and matches nothing. Re-indexing costs one
      // fetch of the single .md being viewed.
      maxAge: 0,
      // Index the document being viewed. "auto" crawls the sidebar, and this server
      // runs with loadSidebar: false — so it only ever indexed the landing README and
      // never the uploaded file, i.e. search matched nothing at all. The hash has
      // already been through isDocRoute() by the time this runs.
      paths: [location.hash.replace(/^#/, "").split("?")[0] || "/"],
      placeholder: "Search",
      noData: "No results found",
      depth: 2,
      hideOtherSidebarContent: false,
    },

    toc: {
      scope: ".markdown-section",
      headings: "h2, h3, h4, h5, h6",
      title: "",
    },

    // Name the browser tab after the document, not after this viewer. A link people
    // share ends up in tabs, bookmarks and previews, and "MD Web" told the reader
    // nothing about what they opened. docsify 4 leaves document.title alone, so set
    // it from the first heading and fall back to the static <title>.
    plugins: [
      function (hook) {
        var fallback = document.title;
        hook.doneEach(function () {
          var h = document.querySelector(".markdown-section h1, .markdown-section h2");
          var t = h && h.textContent ? h.textContent.trim() : "";
          document.title = t || fallback;
        });
      },
    ],
  };
})();
