export default defineBackground(() => {
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

  type RecordHiddenMessage = {
    type: "workser:record-hidden";
    payload: {
      hiddenNow: number;
      siteKey: SiteKey;
      ruleHits: Record<string, number>;
    };
  };

  type UpdateBadgeMessage = {
    type: "workser:update-badge";
    payload: { count: number };
  };

  const counterItem = storage.defineItem<number>("local:workser_hidden_count", { defaultValue: 0 });
  const metricsItem = storage.defineItem<MetricsStore>("local:workser_metrics", {
    defaultValue: {
      totalHidden: 0,
      daily: {},
      ruleHits: {},
    },
  });
  const retentionItem = storage.defineItem<RetentionDays>("local:workser_metrics_retention_days", { defaultValue: 90 });

  const buildEmptyDaily = (): DailyMetrics => ({
    hidden: 0,
    bySite: {
      linkedin: 0,
      indeed: 0,
      computrabajo: 0,
      other: 0,
    },
  });

  const getDateKey = (date = new Date()): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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

  let writeQueue = Promise.resolve();

  function enqueueWork(task: () => Promise<void>) {
    writeQueue = writeQueue.then(task).catch((err) => {
      console.error("Workser background metrics error", err);
    });
  }

  async function applyRecordHidden(payload: RecordHiddenMessage["payload"]) {
    if (!payload.hiddenNow || payload.hiddenNow <= 0) return;

    const currentCounter = (await counterItem.getValue()) ?? 0;
    await counterItem.setValue(currentCounter + payload.hiddenNow);

    const metrics = (await metricsItem.getValue()) ?? { totalHidden: 0, daily: {}, ruleHits: {} };
    const retention = normalizeRetentionDays(await retentionItem.getValue());
    const dateKey = getDateKey();

    metrics.totalHidden += payload.hiddenNow;

    const today = metrics.daily[dateKey] ?? buildEmptyDaily();
    today.hidden += payload.hiddenNow;
    today.bySite[payload.siteKey] += payload.hiddenNow;
    metrics.daily[dateKey] = today;

    Object.entries(payload.ruleHits).forEach(([rule, count]) => {
      metrics.ruleHits[rule] = (metrics.ruleHits[rule] ?? 0) + count;
    });

    metrics.daily = pruneDailyMetrics(metrics.daily, retention);
    await metricsItem.setValue(metrics);
  }

  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    const typed = message as Partial<RecordHiddenMessage> | Partial<UpdateBadgeMessage>;

    if (typed?.type === "workser:record-hidden" && typed.payload) {
      enqueueWork(async () => {
        await applyRecordHidden(typed.payload as RecordHiddenMessage["payload"]);
      });
    }

    if (typed?.type === "workser:update-badge" && sender.tab?.id != null) {
      const count = (typed as Partial<UpdateBadgeMessage>).payload?.count ?? 0;
      const tabId = sender.tab.id;
      const text = count > 0 ? String(count) : "";
      browser.action.setBadgeText({ tabId, text });
      if (count > 0) {
        browser.action.setBadgeBackgroundColor({ tabId, color: "#1f6feb" });
      }
    }
  });

  retentionItem.watch((val) => {
    enqueueWork(async () => {
      const retention = normalizeRetentionDays(val);
      const metrics = (await metricsItem.getValue()) ?? { totalHidden: 0, daily: {}, ruleHits: {} };
      metrics.daily = pruneDailyMetrics(metrics.daily, retention);
      await metricsItem.setValue(metrics);
    });
  });
});
