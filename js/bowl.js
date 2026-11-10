// Presale bowl gauge: presentational only. Mirrors the sold percentage
// that app.js writes into #soldPct onto the SVG ring around it.
(function () {
  var arc = document.getElementById("bowlArc");
  var label = document.getElementById("soldPct");
  if (!arc || !label) return;
  var C = 879.6; // 2 * PI * 140
  function sync() {
    var m = /([0-9]+(?:\.[0-9]+)?)\s*%/.exec(label.textContent || "");
    var p = m ? Math.min(100, Math.max(0, parseFloat(m[1]))) : 0;
    arc.style.strokeDashoffset = (C * (1 - p / 100)).toFixed(1);
  }
  sync();
  setInterval(sync, 600);
})();
