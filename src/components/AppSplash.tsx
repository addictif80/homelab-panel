/**
 * The in-app launch splash — same technique as addictif80/familyboard's templates/layout.php:
 * picks straight up where the native OS splash (apple-touch-startup-image / Android's generated
 * one, both driven by the same mark) leaves off, with no visible seam, then fades into the real
 * UI. Deliberately a plain server component with an inline <script>, not a "use client" +
 * useEffect — a script tag runs synchronously while the HTML is still parsing, before the first
 * paint, so a session that shouldn't see the splash (not installed standalone, already seen this
 * session, reduced-motion) never flashes it even for a frame; a useEffect only runs after
 * hydration, too late to prevent that first paint.
 *
 * Shown at most once per browser session (sessionStorage), and only when running "installed"
 * (display-mode: standalone / iOS's navigator.standalone) — never on an ordinary browser tab.
 */
export default function AppSplash() {
  return (
    <>
      <div id="app-splash" className="app-splash" aria-hidden="true">
        <div className="app-splash-mark">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <defs>
              <linearGradient id="splashMarkGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#6D5BFA" />
                <stop offset="100%" stopColor="#C026D3" />
              </linearGradient>
            </defs>
            <rect width="100" height="100" rx="22" fill="url(#splashMarkGradient)" />
            <g fill="#fff">
              <rect x="26" y="30" width="48" height="13" rx="4" fillOpacity=".95" />
              <rect x="26" y="46.5" width="48" height="13" rx="4" fillOpacity=".8" />
              <rect x="26" y="63" width="48" height="13" rx="4" fillOpacity=".65" />
              <circle cx="33" cy="36.5" r="2.6" fill="#1A1A2E" />
            </g>
            <circle cx="68" cy="36.5" r="5.5" fill="#34D399" stroke="#6D5BFA" strokeWidth="2" />
          </svg>
        </div>
        <div className="app-splash-word">Homelab Panel</div>
      </div>
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `(function(){try{
            var el=document.getElementById('app-splash');
            var standalone=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;
            var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            var seen=sessionStorage.getItem('hlp-splash-shown');
            if(!standalone||reduced||seen){el.remove();return;}
            sessionStorage.setItem('hlp-splash-shown','1');
            var removed=false;
            function removeSplash(){if(removed)return;removed=true;el.classList.add('fade-out');setTimeout(function(){el.remove();},220);}
            window.addEventListener('load',function(){setTimeout(removeSplash,200);});
            setTimeout(removeSplash,1400);
          }catch(e){var el2=document.getElementById('app-splash');if(el2)el2.remove();}})();`,
        }}
      />
    </>
  );
}
