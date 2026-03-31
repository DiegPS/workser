export default defineContentScript({
  matches: [
    "https://*.indeed.com/*",
    "https://*.linkedin.com/*",
    "https://*.computrabajo.com/*"
  ],

  main() {
    type SiteKey = "linkedin" | "indeed" | "computrabajo" | "other";

    const getSiteKey = (host: string): SiteKey => {
      if (host.includes("linkedin.com")) return "linkedin";
      if (host.includes("indeed.com")) return "indeed";
      if (host.includes("computrabajo.com")) return "computrabajo";
      return "other";
    };

    const companiesItem = storage.defineItem<string[]>("local:blocked_companies", { defaultValue: [] });
    const keywordsItem  = storage.defineItem<string[]>("local:blocked_keywords",  { defaultValue: [] });
    const modeItem      = storage.defineItem<"hide" | "blur">("local:workser_mode", { defaultValue: "hide" });
    const enabledItem   = storage.defineItem<boolean>("local:workser_enabled", { defaultValue: true });

    let blockedCompanies: string[] = [];
    let blockedKeywords:  string[] = [];
    let currentMode: "hide" | "blur" = "hide";
    let isEnabled = true;

    // Inyectar CSS global para los modos de ocultación
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `
      [data-workser-blocked="true"] {
        transition: filter 0.3s, opacity 0.3s;
      }
      body[data-workser-mode="hide"] [data-workser-blocked="true"] {
        display: none !important;
      }
      body[data-workser-mode="blur"] [data-workser-blocked="true"] {
        filter: blur(8px) grayscale(100%) !important;
        opacity: 0.5 !important;
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(styleEl);

    function enqueueCounters(hiddenNow: number, siteKey: SiteKey, ruleHits: Record<string, number>) {
      if (hiddenNow <= 0) return;

      browser.runtime.sendMessage({
        type: "workser:record-hidden",
        payload: {
          hiddenNow,
          siteKey,
          ruleHits,
        },
      }).catch(() => {
        // Ignorar errores de mensajería para no interrumpir el filtrado.
      });
    }

    function getMatchedRule(text: string): string | null {
      for (const company of blockedCompanies) {
        if (company && text.includes(company)) return `company:${company}`;
      }
      for (const keyword of blockedKeywords) {
        if (keyword && text.includes(keyword)) return `keyword:${keyword}`;
      }
      return null;
    }

    function matchesBlockedRule(node: HTMLElement): boolean {
      const text = node.innerText?.toLowerCase() ?? "";
      if (!text) return false;

      return (
        blockedCompanies.some(c => c && text.includes(c)) ||
        blockedKeywords.some(k => k && text.includes(k))
      );
    }

    // Aplica el estado bloqueado/desbloqueado según filtros actuales
    // Devuelve true solo si la tarjeta pasó de visible a bloqueada en esta pasada
    function reconcileCardState(node: HTMLElement): { blockedNow: boolean; matchedRule: string | null } {
      const text = node.innerText?.toLowerCase() ?? "";
      const matches = isEnabled && text ? matchesBlockedRule(node) : false;
      const isBlocked = node.dataset.workserBlocked === "true";

      if (!matches) {
        if (isBlocked) delete node.dataset.workserBlocked;
        return { blockedNow: false, matchedRule: null };
      }

      if (isBlocked) return { blockedNow: false, matchedRule: null };

      node.dataset.workserBlocked = "true";
      return { blockedNow: true, matchedRule: getMatchedRule(text) };
    }

    // Escanea todos los trabajos y devuelve cuántos ocultó en esta pasada
    function cleanJobs(): { hiddenNow: number; siteKey: SiteKey; ruleHits: Record<string, number> } {
      const host = location.hostname;
      const siteKey = getSiteKey(host);
      let selectors = "";

      if (host.includes("indeed.com"))            selectors = ".job_seen_beacon";
      else if (host.includes("linkedin.com"))      selectors = ".jobs-search-results__list-item, .scaffold-layout__list-item, .job-card-container, .job-search-card, div[data-component-type='LazyColumn'] > div[data-display-contents='true']";
      else if (host.includes("computrabajo.com"))  selectors = ".box_offer";

      if (!selectors) return { hiddenNow: 0, siteKey, ruleHits: {} };

      let hiddenNow = 0;
      const ruleHits: Record<string, number> = {};
      document.querySelectorAll<HTMLElement>(selectors).forEach(card => {
        const result = reconcileCardState(card);
        if (!result.blockedNow) return;
        hiddenNow++;
        if (result.matchedRule) {
          ruleHits[result.matchedRule] = (ruleHits[result.matchedRule] ?? 0) + 1;
        }
      });
      return { hiddenNow, siteKey, ruleHits };
    }

    // Escanear y luego actualizar el contador con el total de esta pasada
    async function scanAndCount() {
      const scanResult = cleanJobs();
      enqueueCounters(scanResult.hiddenNow, scanResult.siteKey, scanResult.ruleHits);
    }

    // MutationObserver — para scroll infinito y carga dinámica
    const observer = new MutationObserver(() => {
      scanAndCount();
    });

    // Boot
    async function init() {
      blockedCompanies = (await companiesItem.getValue() ?? []).map(c => c.toLowerCase());
      blockedKeywords  = (await keywordsItem.getValue()  ?? []).map(k => k.toLowerCase());
      currentMode      = (await modeItem.getValue()) ?? "hide";
      isEnabled        = (await enabledItem.getValue()) ?? true;
      document.body.dataset.workserMode = currentMode;
      document.body.dataset.workserEnabled = isEnabled ? "true" : "false";

      // Reaccionar si el usuario cambia los filtros desde el popup
      companiesItem.watch((val) => {
        blockedCompanies = (val ?? []).map(c => c.toLowerCase());
        scanAndCount();
      });
      keywordsItem.watch((val) => {
        blockedKeywords = (val ?? []).map(k => k.toLowerCase());
        scanAndCount();
      });
      modeItem.watch((val) => {
        currentMode = val ?? "hide";
        document.body.dataset.workserMode = currentMode;
      });
      enabledItem.watch((val) => {
        isEnabled = val ?? true;
        document.body.dataset.workserEnabled = isEnabled ? "true" : "false";
        scanAndCount();
      });

      await scanAndCount();
      observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
});
