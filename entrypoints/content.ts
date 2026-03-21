export default defineContentScript({
  matches: [
    "https://*.indeed.com/*",
    "https://*.linkedin.com/*",
    "https://*.computrabajo.com/*"
  ],

  main() {
    const companiesItem = storage.defineItem<string[]>("local:blocked_companies", { defaultValue: [] });
    const keywordsItem  = storage.defineItem<string[]>("local:blocked_keywords",  { defaultValue: [] });
    const counterItem   = storage.defineItem<number>("local:workser_hidden_count", { defaultValue: 0  });

    let blockedCompanies: string[] = [];
    let blockedKeywords:  string[] = [];

    // Sumar N al contador — UNA sola lectura+escritura para evitar race condition
    async function addToCounter(n: number) {
      if (n <= 0) return;
      const current = await counterItem.getValue() ?? 0;
      await counterItem.setValue(current + n);
    }

    // Devuelve true si la tarjeta fue ocultada ahora, false si ya lo estaba
    function tryHideCard(node: HTMLElement): boolean {
      // Evitar ocultar dos veces en la misma sesión de DOM
      if (node.dataset.workserBlocked === "true") return false;

      const text = node.innerText?.toLowerCase() ?? "";
      if (!text) return false;

      const matches =
        blockedCompanies.some(c => c && text.includes(c)) ||
        blockedKeywords.some(k => k && text.includes(k));

      if (!matches) return false;

      node.style.display = "none";
      node.dataset.workserBlocked = "true";
      return true;
    }

    // Escanea todos los trabajos y devuelve cuántos ocultó en esta pasada
    function cleanJobs(): number {
      if (!blockedCompanies.length && !blockedKeywords.length) return 0;

      const host = location.hostname;
      let selectors = "";

      if (host.includes("indeed.com"))            selectors = ".job_seen_beacon";
      else if (host.includes("linkedin.com"))      selectors = ".jobs-search-results__list-item, .scaffold-layout__list-item, .job-card-container, .job-search-card, div[data-component-type='LazyColumn'] > div[data-display-contents='true']";
      else if (host.includes("computrabajo.com"))  selectors = ".box_offer";

      if (!selectors) return 0;

      let hiddenNow = 0;
      document.querySelectorAll<HTMLElement>(selectors).forEach(card => {
        if (tryHideCard(card)) hiddenNow++;
      });
      return hiddenNow;
    }

    // Escanear y luego actualizar el contador con el total de esta pasada
    async function scanAndCount() {
      const hiddenNow = cleanJobs();
      if (hiddenNow > 0) await addToCounter(hiddenNow);
    }

    // MutationObserver — para scroll infinito y carga dinámica
    const observer = new MutationObserver(() => {
      scanAndCount();
    });

    // Boot
    async function init() {
      blockedCompanies = (await companiesItem.getValue() ?? []).map(c => c.toLowerCase());
      blockedKeywords  = (await keywordsItem.getValue()  ?? []).map(k => k.toLowerCase());

      // Reaccionar si el usuario cambia los filtros desde el popup
      companiesItem.watch((val) => {
        blockedCompanies = (val ?? []).map(c => c.toLowerCase());
        scanAndCount();
      });
      keywordsItem.watch((val) => {
        blockedKeywords = (val ?? []).map(k => k.toLowerCase());
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
