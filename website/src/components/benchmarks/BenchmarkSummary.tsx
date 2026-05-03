import {useMemo, type JSX} from 'react';
import {SERIES_COLORS, median, getSeriesValues, type SeriesMeta, type Project, type BenchPoint} from './BenchmarksDashboard';

interface Props {
  data: Record<string, Record<string, Record<string, Array<BenchPoint>>>>;
  seriesOrder: readonly string[];
  seriesMeta: Record<string, SeriesMeta>;
  projects: Array<Project>;
  mutedSeries: Record<string, boolean>;
}

function aggregate(
  scenarioId: string,
  data: Props[`data`],
  seriesOrder: readonly string[],
  seriesMeta: Record<string, SeriesMeta>,
  projects: Array<Project>,
  mutedSeries: Record<string, boolean>,
) {
  const validProjects: Array<{id: string; max: number}> = [];
  for (const p of projects) {
    let mx = 0;
    let contributors = 0;
    for (const sid of seriesOrder) {
      if (mutedSeries[sid]) continue;
      const projectData = data[scenarioId]?.[p.id];
      if (!projectData) continue;
      const m = median(getSeriesValues(projectData, sid));
      if (m > 0) {contributors++; if (m > mx) mx = m;}
    }
    if (contributors >= 2) validProjects.push({id: p.id, max: mx});
  }

  const out: Array<{id: string; name: string; normalized: number; color: string; accent: boolean}> = [];
  for (const sid of seriesOrder) {
    if (mutedSeries[sid]) continue;
    let prod = 1;
    let count = 0;
    for (const vp of validProjects) {
      const projectData = data[scenarioId]?.[vp.id];
      if (!projectData) continue;
      const m = median(getSeriesValues(projectData, sid));
      if (m > 0 && vp.max > 0) {
        prod *= (m / vp.max);
        count++;
      }
    }
    if (count > 0) {
      out.push({
        id: sid,
        name: seriesMeta[sid].name,
        normalized: Math.pow(prod, 1 / count),
        color: SERIES_COLORS[sid],
        accent: seriesMeta[sid].accent,
      });
    }
  }

  out.sort((a, b) => a.normalized - b.normalized);
  return out;
}

function SummaryCard({title, agg}: {title: string; agg: ReturnType<typeof aggregate>}): JSX.Element {
  const max = Math.max(...agg.map(a => a.normalized));

  return (
    <div className="summary-card">
      <h4>{title}</h4>
      <div>
        {agg.map(a => (
          <div key={a.id} className="summary-bar">
            <div className={`lbl${a.accent ? ` self` : ``}`}>{a.name}</div>
            <div className="track">
              <div
                className={`fill${a.accent ? ` self` : ``}`}
                style={{
                  [`--w` as any]: (a.normalized / max).toFixed(3),
                  ...(!a.accent ? {background: a.color} : {}),
                }}
              />
            </div>
            <div className={`val${a.accent ? ` self` : ``}`}>{a.normalized.toFixed(2)}&times;</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BenchmarkSummary({data, seriesOrder, seriesMeta, projects, mutedSeries}: Props): JSX.Element {
  const coldAgg = useMemo(
    () => aggregate(`install-full-cold`, data, seriesOrder, seriesMeta, projects, mutedSeries),
    [data, seriesOrder, seriesMeta, projects, mutedSeries],
  );
  const warmAgg = useMemo(
    () => aggregate(`install-cache-and-lock`, data, seriesOrder, seriesMeta, projects, mutedSeries),
    [data, seriesOrder, seriesMeta, projects, mutedSeries],
  );

  return (
    <>
      <div className="mt-12 mb-6">
        <div className="mono text-[11px] text-[var(--fg-mute)] tracking-[0.12em] uppercase mb-2">&sect; Aggregate</div>
        <h2 className="text-[26px] font-medium tracking-[-0.015em] m-0">Median across all scenarios.</h2>
        <p className="text-[14.5px] text-[var(--fg-dim)] leading-[1.6] mt-2 max-w-[680px] text-pretty">
          Geometric mean of cell medians, normalized to the slowest in each row so the chart compares relative performance across scenarios of different absolute scale. Lower is faster.
        </p>
      </div>
      <div className="summary">
        <SummaryCard title="Cold install · normalized" agg={coldAgg} />
        <SummaryCard title="Cache + lockfile · normalized" agg={warmAgg} />
      </div>
    </>
  );
}
