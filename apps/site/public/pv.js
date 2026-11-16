// E7-S7: the page view, in the first HTML of every zenod.dev page (loaded before the
// script-built page, so a visit counts even when the app bundle is slow or fails).
// One 1x1 image to the alpha9 counter. No cookie, nothing about the visitor: the
// host, the page path, the campaign id from the link (?s=) and the referring host.
// The campaign is kept for the visit so a later sign-up carries it (src/lib/counter.ts).
;(function () {
  try {
    var KEY = "zenod.campaign"
    var store = null
    try { store = window.sessionStorage } catch (e) { store = null }
    var s = null
    try { s = (new URLSearchParams(location.search).get("s") || "").trim().slice(0, 64) || null } catch (e) { s = null }
    try {
      if (s && store) store.setItem(KEY, s)
      if (!s && store) s = store.getItem(KEY)
    } catch (e) { /* storage blocked: the link's own id only */ }
    var r = null
    try {
      var host = document.referrer ? new URL(document.referrer).hostname : ""
      r = host && host !== location.hostname ? host : null
    } catch (e) { r = null }
    var q = new URLSearchParams({ h: "zenod.dev", p: location.pathname || "/" })
    if (s) q.set("s", s)
    if (r) q.set("r", r)
    var img = new Image(1, 1)
    img.referrerPolicy = "no-referrer"
    img.src = "https://signup.alpha9.io/api/public/pv?" + q.toString()
  } catch (e) { /* never break the page */ }
})()
