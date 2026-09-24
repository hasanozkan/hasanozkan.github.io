(function () {
  var bar = document.querySelector('.progress');
  var prose = document.querySelector('.prose');
  if (bar && prose) {
    var onScroll = function () {
      var r = prose.getBoundingClientRect();
      var total = r.height - window.innerHeight;
      var p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
      bar.style.transform = 'scaleX(' + p + ')';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  var toc = document.querySelector('.toc ol');
  if (toc && prose) {
    var hs = prose.querySelectorAll('h2[id]');
    if (hs.length < 2) { document.querySelector('.toc').remove(); return; }
    var links = [];
    hs.forEach(function (h) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id; a.textContent = h.textContent;
      li.appendChild(a); toc.appendChild(li); links.push(a);
    });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) {
            links.forEach(function (l) { l.classList.toggle('on', l.hash === '#' + e.target.id); });
          }
        });
      }, { rootMargin: '0px 0px -70% 0px' });
      hs.forEach(function (h) { io.observe(h); });
    }
  }
})();
