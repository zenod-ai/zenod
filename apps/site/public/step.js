// E7-S7: the sign-up steps on cloud.zenod.dev's server-built pages (/join). A click on a
// link marked data-step="oauth_google" tells the alpha9 counter that step: the step's
// name and this host only, no cookie, nothing about the visitor. keepalive lets the
// call finish while the browser follows the link.
;(function () {
  var COUNTER = "https://signup.alpha9.io/api/public/pv"
  function step(k) {
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(k)) return
    var url = COUNTER + "?e=step&k=" + k + "&h=" + encodeURIComponent(location.hostname)
    try {
      fetch(url, { mode: "no-cors", keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" })
    } catch (e) {
      var img = new Image(1, 1)
      img.referrerPolicy = "no-referrer"
      img.src = url
    }
  }
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("[data-step]") : null
    if (link) step(link.getAttribute("data-step"))
  })
})()
