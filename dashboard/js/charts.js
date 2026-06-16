/**
 * ============================================================================
 *  charts.js — Chart.js grafikleri (alarm sayısı, timeline, trend)
 *  ----------------------------------------------------------------------------
 *  Üç grafik:
 *    1) alarmCount : bar  — zamana göre alarm sayısı (saatlik/günlük gruplama)
 *    2) timeline   : scatter — her alarm bir nokta, üzerine gelince süresi görünür
 *    3) trend      : line — pil voltajı + sinyal gücü (RSSI) trendi
 *
 *  Hafif tutmak için tek bağımlılık Chart.js'tir (CDN ile yüklenir).
 * ============================================================================
 */

const Charts = (() => {
  let alarmCountChart = null;
  let timelineChart = null;
  let trendChart = null;
  let theme = 'dark';

  // Durum renkleri
  const COLORS = {
    accent: '#22d3ee',   // neon camgöbeği
    danger: '#ef4444',   // kırmızı (alarm)
    warn:   '#f59e0b',   // sarı (uyarı)
    safe:   '#22c55e',   // yeşil
  };

  /** Tema'ya göre ızgara/metin renkleri. */
  function palette() {
    return theme === 'dark'
      ? { text: '#94a3b8', grid: 'rgba(148,163,184,0.12)' }
      : { text: '#475569', grid: 'rgba(71,85,105,0.15)' };
  }

  /** Saniye epoch -> okunur etiket. */
  function fmtTime(epochSec, withDate = false) {
    const d = new Date(epochSec * 1000);
    const opts = withDate
      ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { hour: '2-digit', minute: '2-digit' };
    return d.toLocaleString(getLang() === 'tr' ? 'tr-TR' : 'en-US', opts);
  }

  /** Alarmları zaman kovalarına böler (grafik 1). */
  function bucketize(alarms, range, refNowSec) {
    // Cihazın saati (NTP) tarayıcının saatiyle senkron olmayabilir; "şimdi" referansı
    // olarak mümkünse cihazın kendi son bildirdiği zaman damgası kullanılır, böylece
    // alarm zaman damgalarıyla aynı saat ekseninde kalır (aksi halde kova aralığının
    // dışında kalıp grafikte hiç görünmeyebilirler).
    const now = refNowSec || Date.now() / 1000;
    // [kova sayısı, kova genişliği(sn), tarihli etiket mi]
    const cfg = {
      '1h':  [12, 300,    false], // 12 x 5dk
      '24h': [24, 3600,   false], // 24 x 1saat
      '7d':  [7,  86400,  true],  // 7 x 1gün
      '30d': [30, 86400,  true],  // 30 x 1gün
    }[range] || [24, 3600, false];

    const [count, width, withDate] = cfg;
    const buckets = new Array(count).fill(0);
    const labels = [];
    const start = now - count * width;

    for (let i = 0; i < count; i++) {
      labels.push(fmtTime(start + i * width + (withDate ? 0 : 0), withDate));
    }
    alarms.forEach((a) => {
      const idx = Math.floor((a.start - start) / width);
      if (idx >= 0 && idx < count) buckets[idx]++;
    });
    return { labels, buckets };
  }

  /** Üç grafiği de boş halde oluşturur. */
  function init() {
    const p = palette();
    Chart.defaults.color = p.text;
    Chart.defaults.font.family = "'Inter','Space Grotesk',sans-serif";

    // 1) Alarm sayısı (bar)
    alarmCountChart = new Chart(document.getElementById('chartAlarmCount'), {
      type: 'bar',
      data: { labels: [], datasets: [{
        label: t('alarms'),
        data: [],
        backgroundColor: COLORS.danger + 'cc',
        borderRadius: 4,
        maxBarThickness: 26,
      }]},
      options: baseOptions({ yBeginsAtZero: true, yInteger: true }),
    });

    // 2) Timeline (scatter)
    timelineChart = new Chart(document.getElementById('chartTimeline'), {
      type: 'scatter',
      data: { datasets: [{
        label: t('chartTimeline'),
        data: [],
        backgroundColor: COLORS.warn,
        borderColor: COLORS.danger,
        pointRadius: (ctx) => ctx.raw ? Math.min(14, 4 + ctx.raw.dur / 10) : 4,
        pointHoverRadius: (ctx) => ctx.raw ? Math.min(16, 6 + ctx.raw.dur / 10) : 6,
      }]},
      options: {
        ...baseOptions({}),
        scales: {
          x: { type: 'linear', ticks: { callback: (v) => fmtTime(v, true) }, grid: { color: p.grid } },
          y: { display: false, min: 0, max: 2 },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const r = ctx.raw;
                return `${fmtTime(r.x, true)} • ${t('colDuration')}: ${r.dur}s`;
              },
            },
          },
        },
      },
    });

    // 3) Trend (line, çift eksen)
    trendChart = new Chart(document.getElementById('chartTrend'), {
      type: 'line',
      data: { labels: [], datasets: [
        {
          label: t('voltage'), data: [], yAxisID: 'yV',
          borderColor: COLORS.safe, backgroundColor: COLORS.safe + '22',
          tension: 0.35, pointRadius: 0, borderWidth: 2, fill: true,
        },
        {
          label: t('rssi'), data: [], yAxisID: 'yR',
          borderColor: COLORS.accent, backgroundColor: 'transparent',
          tension: 0.35, pointRadius: 0, borderWidth: 2,
        },
      ]},
      options: {
        ...baseOptions({}),
        scales: {
          x: { ticks: { maxTicksLimit: 6 }, grid: { color: p.grid } },
          yV: { position: 'left',  grid: { color: p.grid }, suggestedMin: 3.2, suggestedMax: 4.3 },
          yR: { position: 'right', grid: { drawOnChartArea: false }, suggestedMin: -95, suggestedMax: -40 },
        },
      },
    });
  }

  function baseOptions({ yBeginsAtZero, yInteger }) {
    const p = palette();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: { legend: { labels: { color: p.text } } },
      scales: {
        x: { grid: { color: p.grid }, ticks: { color: p.text, maxTicksLimit: 12 } },
        y: {
          beginAtZero: !!yBeginsAtZero,
          grid: { color: p.grid },
          ticks: { color: p.text, precision: yInteger ? 0 : undefined },
        },
      },
    };
  }

  /* ----------------------------- Güncelleme ------------------------------ */
  function renderAlarmCount(alarms, range, refNowSec) {
    if (!alarmCountChart) return;
    const { labels, buckets } = bucketize(alarms, range, refNowSec);
    alarmCountChart.data.labels = labels;
    alarmCountChart.data.datasets[0].data = buckets;
    alarmCountChart.data.datasets[0].label = t('alarms');
    alarmCountChart.update();
  }

  function renderTimeline(alarms) {
    if (!timelineChart) return;
    timelineChart.data.datasets[0].data = alarms.map((a) => ({
      x: a.start, y: 1, dur: a.durationSec,
    }));
    timelineChart.update();
  }

  function renderTrend(telemetry) {
    if (!trendChart) return;
    trendChart.data.labels = telemetry.map((s) => fmtTime(s.t));
    trendChart.data.datasets[0].data = telemetry.map((s) => s.voltage);
    trendChart.data.datasets[1].data = telemetry.map((s) => s.rssi);
    trendChart.data.datasets[0].label = t('voltage');
    trendChart.data.datasets[1].label = t('rssi');
    trendChart.update('none'); // canlı akışta titremesin
  }

  /** Tema değişince ızgara/metin renklerini yeniler. */
  function setTheme(newTheme) {
    theme = newTheme;
    const p = palette();
    Chart.defaults.color = p.text;
    [alarmCountChart, timelineChart, trendChart].forEach((ch) => {
      if (!ch) return;
      Object.values(ch.options.scales || {}).forEach((sc) => {
        if (sc.grid) sc.grid.color = p.grid;
        if (sc.ticks) sc.ticks.color = p.text;
      });
      if (ch.options.plugins?.legend?.labels) ch.options.plugins.legend.labels.color = p.text;
      ch.update('none');
    });
  }

  /** Dil değişince eksen/veri etiketlerini yeniler. */
  function relabel() {
    if (alarmCountChart) { alarmCountChart.data.datasets[0].label = t('alarms'); alarmCountChart.update('none'); }
    if (timelineChart)   { timelineChart.update('none'); }
    if (trendChart) {
      trendChart.data.datasets[0].label = t('voltage');
      trendChart.data.datasets[1].label = t('rssi');
      trendChart.update('none');
    }
  }

  return { init, renderAlarmCount, renderTimeline, renderTrend, setTheme, relabel };
})();

window.Charts = Charts;
