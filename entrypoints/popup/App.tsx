import { useEffect, useMemo, useState } from "react";

const blockedCompaniesKey = "local:blocked_companies";
const blockedKeywordsKey = "local:blocked_keywords";
const hiddenCountKey = "local:workser_hidden_count";
const modeKey = "local:workser_mode";
const enabledKey = "local:workser_enabled";
const metricsRetentionKey = "local:workser_metrics_retention_days";

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

type SiteStat = {
  key: Exclude<SiteKey, "other">;
  label: string;
  count: number;
};

type SortMode = "recent" | "az" | "za";

type ActiveSite = Exclude<SiteKey, "other"> | null;

const metricsKey = "local:workser_metrics";

const companiesStorage = storage.defineItem<string[]>(blockedCompaniesKey, { defaultValue: [] });
const keywordsStorage = storage.defineItem<string[]>(blockedKeywordsKey, { defaultValue: [] });
const counterStorage = storage.defineItem<number>(hiddenCountKey, { defaultValue: 0 });
const modeStorage = storage.defineItem<"hide" | "blur">(modeKey, { defaultValue: "hide" });
const enabledStorage = storage.defineItem<boolean>(enabledKey, { defaultValue: true });
const metricsRetentionStorage = storage.defineItem<RetentionDays>(metricsRetentionKey, { defaultValue: 90 });
const metricsStorage = storage.defineItem<MetricsStore>(metricsKey, {
  defaultValue: {
    totalHidden: 0,
    daily: {},
    ruleHits: {},
  },
});

const SITE_ITEMS: Array<{ key: Exclude<SiteKey, "other">; label: string }> = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "indeed", label: "Indeed" },
  { key: "computrabajo", label: "Computrabajo" },
];

function detectSiteFromUrl(url: string | undefined): ActiveSite {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.includes("linkedin.com")) return "linkedin";
    if (host.includes("indeed.com")) return "indeed";
    if (host.includes("computrabajo.com")) return "computrabajo";
    return null;
  } catch {
    return null;
  }
}

function getDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getLastDaysKeys(days: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(getDateKey(d));
  }
  return keys;
}

function shortDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("es-ES", { weekday: "short" }).slice(0, 3);
}

function prettyRuleLabel(rule: string): string {
  if (rule.startsWith("company:")) return `Empresa: ${rule.replace("company:", "")}`;
  if (rule.startsWith("keyword:")) return `Keyword: ${rule.replace("keyword:", "")}`;
  return rule;
}

function normalizeRuleValue(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRulesList(values: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  (values ?? []).forEach((value) => {
    const clean = normalizeRuleValue(value);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    normalized.push(clean);
  });

  return normalized;
}

function normalizeRetentionDays(value: number | null | undefined): RetentionDays {
  if (value === 30 || value === 180) return value;
  return 90;
}

function getSpanishGroupKey(item: string): string {
  const first = item.trim().charAt(0);
  if (!first) return "#";

  const upper = first.toLocaleUpperCase("es-ES");
  if (upper === "Ñ") return "Ñ";

  const normalized = upper.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /^[A-Z]$/.test(normalized) ? normalized : "#";
}

export default function App() {
  const [companies, setCompanies] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [mode, setMode] = useState<"hide" | "blur">("hide");
  const [showSettings, setShowSettings] = useState(false);
  const [isEnabled, setIsEnabled] = useState(true);
  const [metricsRetentionDays, setMetricsRetentionDays] = useState<RetentionDays>(90);
  const [activeTab, setActiveTab] = useState<"companies" | "keywords">("companies");
  const [inputValue, setInputValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [listSearch, setListSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [mainTab, setMainTab] = useState<"filters" | "metrics">("filters");
  const [metrics, setMetrics] = useState<MetricsStore>({ totalHidden: 0, daily: {}, ruleHits: {} });
  const [activeSite, setActiveSite] = useState<ActiveSite>(null);

  useEffect(() => {
    companiesStorage.getValue().then((val) => {
      const normalized = normalizeRulesList(val);
      setCompanies(normalized);
      if (JSON.stringify(val ?? []) !== JSON.stringify(normalized)) {
        companiesStorage.setValue(normalized);
      }
    });

    keywordsStorage.getValue().then((val) => {
      const normalized = normalizeRulesList(val);
      setKeywords(normalized);
      if (JSON.stringify(val ?? []) !== JSON.stringify(normalized)) {
        keywordsStorage.setValue(normalized);
      }
    });

    counterStorage.getValue().then(setHiddenCount);
    modeStorage.getValue().then((val) => setMode(val ?? "hide"));
    enabledStorage.getValue().then((val) => setIsEnabled(val ?? true));
    metricsRetentionStorage.getValue().then((val) => setMetricsRetentionDays(normalizeRetentionDays(val)));
    metricsStorage.getValue().then((val) => setMetrics(val ?? { totalHidden: 0, daily: {}, ruleHits: {} }));

    const unsubCompanies = companiesStorage.watch((val) => setCompanies(normalizeRulesList(val)));
    const unsubKeywords = keywordsStorage.watch((val) => setKeywords(normalizeRulesList(val)));
    const unsubCounter = counterStorage.watch((val) => setHiddenCount(val ?? 0));
    const unsubMode = modeStorage.watch((val) => setMode(val ?? "hide"));
    const unsubEnabled = enabledStorage.watch((val) => setIsEnabled(val ?? true));
    const unsubRetention = metricsRetentionStorage.watch((val) => setMetricsRetentionDays(normalizeRetentionDays(val)));
    const unsubMetrics = metricsStorage.watch((val) => setMetrics(val ?? { totalHidden: 0, daily: {}, ruleHits: {} }));

    return () => {
      unsubCompanies();
      unsubKeywords();
      unsubCounter();
      unsubMode();
      unsubEnabled();
      unsubRetention();
      unsubMetrics();
    };
  }, []);

  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      setActiveSite(detectSiteFromUrl(tabs[0]?.url));
    }).catch(() => {
      setActiveSite(null);
    });
  }, []);

  useEffect(() => {
    setEditingItem(null);
    setEditingValue("");
    setAddError(null);
  }, [activeTab]);

  const last7Keys = useMemo(() => getLastDaysKeys(7), []);

  const todayKey = useMemo(() => getDateKey(), []);

  const todayHidden = metrics.daily[todayKey]?.hidden ?? 0;

  const weekHidden = useMemo(() => {
    return last7Keys.reduce((acc, key) => acc + (metrics.daily[key]?.hidden ?? 0), 0);
  }, [last7Keys, metrics.daily]);

  const trendData = useMemo(() => {
    return last7Keys.map((key) => ({
      key,
      label: shortDayLabel(key),
      value: metrics.daily[key]?.hidden ?? 0,
    }));
  }, [last7Keys, metrics.daily]);

  const maxTrend = useMemo(() => Math.max(1, ...trendData.map((d) => d.value)), [trendData]);
  const trendPoints = useMemo(() => {
    const width = 100;
    const height = 56;
    const len = trendData.length;
    return trendData.map((item, index) => {
      const x = len > 1 ? (index / (len - 1)) * width : width / 2;
      const y = height - (item.value / maxTrend) * height;
      return { x, y, ...item };
    });
  }, [trendData, maxTrend]);
  const trendLine = useMemo(() => trendPoints.map((p) => `${p.x},${p.y}`).join(" "), [trendPoints]);
  const trendArea = useMemo(() => {
    if (!trendPoints.length) return "";
    const first = trendPoints[0];
    const last = trendPoints[trendPoints.length - 1];
    return `M ${first.x} 56 L ${first.x} ${first.y} ${trendPoints.map((p) => `L ${p.x} ${p.y}`).join(" ")} L ${last.x} 56 Z`;
  }, [trendPoints]);
  const avgTrend = useMemo(() => {
    if (!trendData.length) return 0;
    return trendData.reduce((acc, item) => acc + item.value, 0) / trendData.length;
  }, [trendData]);
  const avgLineY = useMemo(() => {
    const height = 56;
    return height - (avgTrend / maxTrend) * height;
  }, [avgTrend, maxTrend]);

  const bySite = useMemo<SiteStat[]>(() => {
    const values = SITE_ITEMS.map((item) => {
      const count = last7Keys.reduce((acc, key) => {
        const day = metrics.daily[key];
        return acc + (day?.bySite[item.key] ?? 0);
      }, 0);
      return { ...item, count };
    });
    return values;
  }, [last7Keys, metrics.daily]);

  const topRules = useMemo(() => {
    return Object.entries(metrics.ruleHits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [metrics.ruleHits]);

  const maxRuleHits = useMemo(() => Math.max(1, ...topRules.map(([, hits]) => hits)), [topRules]);
  const weekSiteTotal = useMemo(() => bySite.reduce((acc, site) => acc + site.count, 0), [bySite]);
  const activeSiteCount = useMemo(() => {
    if (!activeSite) return 0;
    return bySite.find((site) => site.key === activeSite)?.count ?? 0;
  }, [activeSite, bySite]);
  const activeSiteLabel = activeSite ? SITE_ITEMS.find((site) => site.key === activeSite)?.label ?? "Sitio" : "Sitio no compatible";

  const handleAdd = () => {
    const val = normalizeRuleValue(inputValue);
    if (!val) {
      setAddError(activeTab === "companies" ? "Escribe una empresa valida." : "Escribe una palabra valida.");
      return;
    }

    if (activeTab === "companies") {
      if (companies.includes(val)) {
        setAddError("Esa empresa ya existe en la lista.");
        return;
      }
      const updated = normalizeRulesList([...companies, val]);
      setCompanies(updated);
      companiesStorage.setValue(updated);
    } else {
      if (keywords.includes(val)) {
        setAddError("Esa palabra ya existe en la lista.");
        return;
      }
      const updated = normalizeRulesList([...keywords, val]);
      setKeywords(updated);
      keywordsStorage.setValue(updated);
    }

    setAddError(null);
    setInputValue("");
  };

  const handleRemove = (item: string) => {
    if (activeTab === "companies") {
      const updated = companies.filter((c) => c !== item);
      setCompanies(updated);
      companiesStorage.setValue(updated);
    } else {
      const updated = keywords.filter((k) => k !== item);
      setKeywords(updated);
      keywordsStorage.setValue(updated);
    }
  };

  const handleStartEdit = (item: string) => {
    setEditingItem(item);
    setEditingValue(item);
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
    setEditingValue("");
  };

  const handleSaveEdit = (oldItem: string) => {
    const next = normalizeRuleValue(editingValue);
    if (!next) {
      handleCancelEdit();
      return;
    }

    if (activeTab === "companies") {
      const updated = normalizeRulesList(companies.map((item) => (item === oldItem ? next : item)));
      setCompanies(updated);
      companiesStorage.setValue(updated);
    } else {
      const updated = normalizeRulesList(keywords.map((item) => (item === oldItem ? next : item)));
      setKeywords(updated);
      keywordsStorage.setValue(updated);
    }

    handleCancelEdit();
  };

  const currentList = activeTab === "companies" ? companies : keywords;
  const filteredList = useMemo(() => {
    const search = normalizeRuleValue(listSearch);
    if (!search) return currentList;
    return currentList.filter((item) => item.includes(search));
  }, [currentList, listSearch]);
  const sortedList = useMemo(() => {
    if (sortMode === "recent") return [...filteredList].reverse();
    const next = [...filteredList].sort((a, b) => a.localeCompare(b, "es"));
    if (sortMode === "za") next.reverse();
    return next;
  }, [filteredList, sortMode]);
  const groupedList = useMemo(() => {
    if (sortMode === "recent") {
      return [{ key: "recientes", label: "Recientes", items: sortedList }];
    }

    const groups = new Map<string, string[]>();
    sortedList.forEach((item) => {
      const groupKey = getSpanishGroupKey(item);
      const groupItems = groups.get(groupKey) ?? [];
      groupItems.push(item);
      groups.set(groupKey, groupItems);
    });

    return Array.from(groups.entries()).map(([key, items]) => ({ key, label: key, items }));
  }, [sortedList, sortMode]);

  const isMetricsActive = !showSettings && mainTab === "metrics";
  const canSubmitNewRule = normalizeRuleValue(inputValue).length > 0;

  return (
    <div className="app-container">
      <div className="header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1 className="app-title">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            Workser
          </h1>
          <div className="header-actions">
            <button
              className={`btn-settings ${isMetricsActive ? "active" : ""}`}
              onClick={() => {
                setShowSettings(false);
                setMainTab((prev) => (prev === "metrics" ? "filters" : "metrics"));
              }}
              title="Métricas"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </button>
            <button
              className={`power-switch ${isEnabled ? "on" : "off"}`}
              onClick={() => enabledStorage.setValue(!isEnabled)}
              title={isEnabled ? "Desactivar Workser" : "Activar Workser"}
            >
              <span className="power-label">{isEnabled ? "ON" : "OFF"}</span>
              <span className="power-knob" />
            </button>
            <button className={`btn-settings ${showSettings ? "active" : ""}`} onClick={() => setShowSettings(!showSettings)} title="Ajustes">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
          </div>
        </div>

        {!showSettings && mainTab === "filters" && (
          <div className="home-overview">
            <div className="home-kpi primary">
              <div className="kpi-top">
                <h3>{activeSiteLabel}</h3>
              </div>
              <p>
                {activeSiteCount}
                <span className="kpi-unit">7d</span>
              </p>
            </div>
            <div className="home-kpi secondary">
              <div className="kpi-top">
                <h3>Total acumulado</h3>
              </div>
              <p>
                {hiddenCount}
                <span className="kpi-unit">global</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {showSettings ? (
        <div className="content settings-content">
          <div className="settings-surface">
            <div className="settings-panel">
              <div className="settings-panel-head">
                <h3 className="settings-title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 2v10" />
                    <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
                  </svg>
                  Estado general
                </h3>
              </div>
              <div className="settings-status-row">
                <div>
                  <p className="settings-label">Workser</p>
                  <p className="settings-hint">{isEnabled ? "Filtrando ofertas activamente" : "Filtrado pausado temporalmente"}</p>
                </div>
                <button
                  className={`power-switch ${isEnabled ? "on" : "off"}`}
                  onClick={() => enabledStorage.setValue(!isEnabled)}
                  title={isEnabled ? "Desactivar Workser" : "Activar Workser"}
                >
                  <span className="power-label">{isEnabled ? "ON" : "OFF"}</span>
                  <span className="power-knob" />
                </button>
              </div>
            </div>

            <div className="settings-panel">
              <div className="settings-panel-head">
                <h3 className="settings-title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12c.92-2.6 2.66-4.83 4.94-6.34" />
                    <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a11.86 11.86 0 0 1-4.09 5.94" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                  Modo de ocultamiento
                </h3>
              </div>
              <div className="segmented-control" role="tablist" aria-label="Modo de ocultamiento">
                <button
                  className={`segmented-item ${mode === "hide" ? "active" : ""}`}
                  onClick={() => {
                    setMode("hide");
                    modeStorage.setValue("hide");
                  }}
                >
                  Ocultar
                </button>
                <button
                  className={`segmented-item ${mode === "blur" ? "active" : ""}`}
                  onClick={() => {
                    setMode("blur");
                    modeStorage.setValue("blur");
                  }}
                >
                  Difuminar
                </button>
              </div>
              <p className="settings-hint">
                {mode === "hide"
                  ? "Oculta completamente las ofertas bloqueadas para mantener el feed limpio."
                  : "Mantiene visibles las ofertas bloqueadas, pero con blur y baja opacidad."}
              </p>
            </div>

            <div className="settings-panel">
              <div className="settings-panel-head">
                <h3 className="settings-title">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Retencion de metricas
                </h3>
                <span className="settings-tag">Actual: {metricsRetentionDays}d</span>
              </div>
              <div className="segmented-control" role="tablist" aria-label="Retencion de metricas">
                {[30, 90, 180].map((days) => (
                  <button
                    key={days}
                    className={`segmented-item ${metricsRetentionDays === days ? "active" : ""}`}
                    onClick={() => {
                      const normalized = normalizeRetentionDays(days);
                      setMetricsRetentionDays(normalized);
                      metricsRetentionStorage.setValue(normalized);
                    }}
                  >
                    {days}d
                  </button>
                ))}
              </div>
              <p className="settings-hint">Define cuanta historia conservar para tendencia y distribucion por portal.</p>
            </div>
          </div>
        </div>
      ) : (
        <>
          {mainTab === "filters" ? (
            <>
              <div className="tabs">
                <div className="tabs-buttons">
                  <button className={`tab ${activeTab === "companies" ? "active" : ""}`} onClick={() => setActiveTab("companies")}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="8.5" cy="7" r="4" />
                      <line x1="20" y1="8" x2="20" y2="14" />
                      <line x1="17" y1="11" x2="23" y2="11" />
                    </svg>
                    Empresas
                  </button>
                  <button className={`tab ${activeTab === "keywords" ? "active" : ""}`} onClick={() => setActiveTab("keywords")}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 7h-9" />
                      <path d="M14 17H5" />
                      <circle cx="17" cy="17" r="3" />
                      <circle cx="8" cy="7" r="3" />
                    </svg>
                    Palabras Clave
                  </button>
                </div>
              </div>

              <div className="content">
                <div className="list-controls">
                  <span className="list-sort-label">Orden</span>
                  <select className="list-sort-select" value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                    <option value="recent">Recientes</option>
                    <option value="az">A-Z</option>
                    <option value="za">Z-A</option>
                  </select>
                  <span className="tabs-count">
                    {filteredList.length}/{currentList.length} {activeTab === "companies" ? "empresas" : "palabras"}
                  </span>
                </div>

                <div className="list-search-wrap">
                  <input
                    className="list-search"
                    type="text"
                    placeholder={activeTab === "companies" ? "Buscar empresa..." : "Buscar palabra..."}
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                  />
                </div>

                <div className="input-group">
                  <input
                    type="text"
                    className={addError ? "has-error" : ""}
                    placeholder={activeTab === "companies" ? "Ej. Empresa Spam SA" : "Ej. Call Center, Ventas"}
                    value={inputValue}
                    onChange={(e) => {
                      setInputValue(e.target.value);
                      if (addError) setAddError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  />
                  <button onClick={handleAdd} disabled={!canSubmitNewRule}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
                {addError && <p className="input-error">{addError}</p>}

                {currentList.length === 0 ? (
                  <div className="empty-state">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <p>No hay filtros activos todavia.</p>
                  </div>
                ) : sortedList.length === 0 ? (
                  <div className="empty-state">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <p>Sin resultados para esa busqueda.</p>
                  </div>
                ) : (
                  <div className="filters-list">
                    {groupedList.map((group) => (
                      <div className="list-group" key={group.key}>
                        <p className="list-group-title">{group.label}</p>
                        {group.items.map((item) => (
                          <div className="list-item" key={item}>
                            {editingItem === item ? (
                              <>
                                <input
                                  className="list-edit-input"
                                  value={editingValue}
                                  onChange={(e) => setEditingValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveEdit(item);
                                    if (e.key === "Escape") handleCancelEdit();
                                  }}
                                  autoFocus
                                />
                                <div className="list-actions">
                                  <button className="btn-inline success" onClick={() => handleSaveEdit(item)} title="Guardar">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  </button>
                                  <button className="btn-inline muted" onClick={handleCancelEdit} title="Cancelar">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="18" y1="6" x2="6" y2="18" />
                                      <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <button className="list-text-btn" onClick={() => handleStartEdit(item)} title="Editar">
                                  {item}
                                </button>
                                <button className="btn-remove" onClick={() => handleRemove(item)} title="Eliminar">
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    <line x1="10" y1="11" x2="10" y2="17" />
                                    <line x1="14" y1="11" x2="14" y2="17" />
                                  </svg>
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="content metrics-content">
              <div className="analytics-surface">
                <div className="analytics-summary">
                  <div className="summary-item">
                    <span>Hoy</span>
                    <strong>{todayHidden}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Semana</span>
                    <strong>{weekHidden}</strong>
                  </div>
                  <div className="summary-item">
                    <span>Total</span>
                    <strong>{metrics.totalHidden}</strong>
                  </div>
                </div>

                <div className="analytics-section">
                  <div className="analytics-section-head">
                    <h3>Tendencia (7 días)</h3>
                    <span>{metricsRetentionDays}d de retención</span>
                  </div>
                  <div className="trend-meta">
                    <span>Total semana: {weekHidden}</span>
                    <span>Pico diario: {maxTrend}</span>
                  </div>
                  <div className="trend-chart-wrap">
                    <svg className="trend-svg" viewBox="0 0 100 56" preserveAspectRatio="none" role="img" aria-label="Tendencia de trabajos filtrados en 7 dias">
                      <line x1="0" y1="56" x2="100" y2="56" className="trend-grid" />
                      <line x1="0" y1="38" x2="100" y2="38" className="trend-grid soft" />
                      <line x1="0" y1="20" x2="100" y2="20" className="trend-grid soft" />
                      <line x1="0" y1={avgLineY} x2="100" y2={avgLineY} className="trend-grid avg" />
                      <path d={trendArea} className="trend-area" />
                      <polyline points={trendLine} className="trend-line" />
                      {trendPoints.map((point, index) => {
                        const isToday = index === trendPoints.length - 1;
                        return (
                          <circle
                            key={point.key}
                            cx={point.x}
                            cy={point.y}
                            r={isToday ? 2.2 : 1.8}
                            className={isToday ? "trend-dot today" : "trend-dot"}
                          />
                        );
                      })}
                    </svg>
                    <div className="trend-label-row">
                      {trendPoints.map((point, index) => {
                        const isToday = index === trendPoints.length - 1;
                        return (
                          <div className={`trend-label ${isToday ? "today" : ""}`} key={point.key} title={`${point.label}: ${point.value}`}>
                            <strong>{point.value}</strong>
                            <span>{point.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="analytics-split">
                  <div className="analytics-section">
                    <div className="analytics-section-head">
                      <h3>Distribución por portal (7d)</h3>
                    </div>
                    <div className="site-list">
                      {bySite.map((site) => {
                        const pct = weekSiteTotal > 0 ? Math.round((site.count / weekSiteTotal) * 100) : 0;
                        return (
                          <div className="site-row" key={site.key}>
                            <span>{site.label}</span>
                            <div className="row-right">
                              <em>{pct}%</em>
                              <strong>{site.count}</strong>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="analytics-section">
                    <div className="analytics-section-head">
                      <h3>Top reglas</h3>
                    </div>
                    {topRules.length === 0 ? (
                      <p className="muted">Aun no hay datos suficientes.</p>
                    ) : (
                      <div className="rule-list chart-list">
                        {topRules.map(([rule, hits], index) => (
                          <div className="rule-row chart-row" key={rule}>
                            <div className="chart-row-head">
                              <span className="rule-label"><b>#{index + 1}</b> {prettyRuleLabel(rule)}</span>
                              <strong>{hits}</strong>
                            </div>
                            <div className="chart-track rule-track">
                              <div className="chart-fill rule-fill" style={{ width: `${Math.round((hits / maxRuleHits) * 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="footer">
        <span>{isEnabled ? "Workser Shield Active" : "Workser Shield Paused"}</span>
        <span>v0.0.1</span>
      </div>
    </div>
  );
}
