export default defineContentScript({
  matches: [
    "https://*.indeed.com/*",
    "https://*.linkedin.com/*",
    "https://*.computrabajo.com/*"
  ],

  main() {
    type SiteKey = "linkedin" | "indeed" | "computrabajo" | "other";
    type RetentionDays = 30 | 90 | 180;

    type DailyMetrics = {
      hidden: number;
      bySite: Record<SiteKey, number>;
    };

    type MetricsStore = {
      totalHidden: number;
      daily: Record<string, DailyMetrics>;
      ruleHits: Record<string, number>;
    };

    const buildEmptyDaily = (): DailyMetrics => ({
      hidden: 0,
      bySite: {
        linkedin: 0,
        indeed: 0,
        computrabajo: 0,
        other: 0,
      },
    });

    const buildEmptyMetrics = (): MetricsStore => ({
      totalHidden: 0,
      daily: {},
      ruleHits: {},
    });

    const getDateKey = (date = new Date()): string => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    const getSiteKey = (host: string): SiteKey => {
      if (host.includes("linkedin.com")) return "linkedin";
      if (host.includes("indeed.com")) return "indeed";
      if (host.includes("computrabajo.com")) return "computrabajo";
      return "other";
    };

    const normalizeRetentionDays = (value: number | null | undefined): RetentionDays => {
      if (value === 30 || value === 180) return value;
      return 90;
    };

    const pruneDailyMetrics = (daily: Record<string, DailyMetrics>, retentionDays: RetentionDays): Record<string, DailyMetrics> => {
      const threshold = new Date();
      threshold.setDate(threshold.getDate() - retentionDays);
      const thresholdKey = getDateKey(threshold);

      const pruned: Record<string, DailyMetrics> = {};
      Object.entries(daily).forEach(([key, value]) => {
        if (key >= thresholdKey) pruned[key] = value;
      });
      return pruned;
    };

    const companiesItem = storage.defineItem<string[]>("local:blocked_companies", { defaultValue: [] });
    const keywordsItem  = storage.defineItem<string[]>("local:blocked_keywords",  { defaultValue: [] });
    const counterItem   = storage.defineItem<number>("local:workser_hidden_count", { defaultValue: 0  });
    const modeItem      = storage.defineItem<"hide" | "blur">("local:workser_mode", { defaultValue: "hide" });
    const enabledItem   = storage.defineItem<boolean>("local:workser_enabled", { defaultValue: true });
    const retentionItem = storage.defineItem<RetentionDays>("local:workser_metrics_retention_days", { defaultValue: 90 });
    const metricsItem   = storage.defineItem<MetricsStore>("local:workser_metrics", { defaultValue: buildEmptyMetrics() });

    let blockedCompanies: string[] = [];
    let blockedKeywords:  string[] = [];
    let currentMode: "hide" | "blur" = "hide";
    let isEnabled = true;
    let metricsRetentionDays: RetentionDays = 90;

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

    // Sumar N al contador — UNA sola lectura+escritura para evitar race condition
    async function addToCounter(n: number) {
      if (n <= 0) return;
      const current = await counterItem.getValue() ?? 0;
      await counterItem.setValue(current + n);
    }

    async function addToMetrics(hiddenNow: number, siteKey: SiteKey, ruleHits: Record<string, number>) {
      if (hiddenNow <= 0) return;

      const metrics = (await metricsItem.getValue()) ?? buildEmptyMetrics();
      const dateKey = getDateKey();

      metrics.totalHidden += hiddenNow;

      const today = metrics.daily[dateKey] ?? buildEmptyDaily();
      today.hidden += hiddenNow;
      today.bySite[siteKey] += hiddenNow;
      metrics.daily[dateKey] = today;

      Object.entries(ruleHits).forEach(([rule, count]) => {
        metrics.ruleHits[rule] = (metrics.ruleHits[rule] ?? 0) + count;
      });

      metrics.daily = pruneDailyMetrics(metrics.daily, metricsRetentionDays);

      await metricsItem.setValue(metrics);
    }

    let writeQueue = Promise.resolve();

    function enqueueCounters(hiddenNow: number, siteKey: SiteKey, ruleHits: Record<string, number>) {
      if (hiddenNow <= 0) return;

      writeQueue = writeQueue
        .then(async () => {
          await addToCounter(hiddenNow);
          await addToMetrics(hiddenNow, siteKey, ruleHits);
        })
        .catch((err) => {
          console.error("Workser metrics update failed", err);
        });
    }

    function enqueueMetricsPrune() {
      writeQueue = writeQueue
        .then(async () => {
          const metrics = (await metricsItem.getValue()) ?? buildEmptyMetrics();
          metrics.daily = pruneDailyMetrics(metrics.daily, metricsRetentionDays);
          await metricsItem.setValue(metrics);
        })
        .catch((err) => {
          console.error("Workser metrics prune failed", err);
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
      metricsRetentionDays = normalizeRetentionDays(await retentionItem.getValue());
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
      retentionItem.watch((val) => {
        metricsRetentionDays = normalizeRetentionDays(val);
        enqueueMetricsPrune();
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
