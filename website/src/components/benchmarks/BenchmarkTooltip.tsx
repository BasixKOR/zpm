import {useRef, useLayoutEffect, type JSX} from 'react';
import {SERIES_COLORS, type SeriesMeta} from './BenchmarksDashboard';

export interface HoverInfo {
  mouseX: number;
  mouseY: number;
  index: number;
  dateStr: string;
  scenarioTitle: string;
  projectName: string;
  isIncident: boolean;
  incidentLabel?: string;
  rows: Array<{id: string; value: number}>;
  versionMap: Record<string, string> | null;
  showVersions: boolean;
  seriesMeta: Record<string, SeriesMeta>;
}

export function BenchmarkTooltip({info}: {info: HoverInfo | null}): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!info || !ref.current) return;
    const el = ref.current;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let tx = info.mouseX + 14;
    let ty = info.mouseY + 14;
    if (tx + tw > window.innerWidth - 12) tx = info.mouseX - tw - 14;
    if (ty + th > window.innerHeight - 12) ty = info.mouseY - th - 14;
    el.style.left = `${tx}px`;
    el.style.top = `${ty}px`;
  });

  if (!info) return null;

  return (
    <div className={`bench-tip show`} ref={ref}>
      {info.isIncident ? (
        <>
          <div className="tip-x">{info.dateStr} &middot; {info.projectName}</div>
          <div style={{color: `oklch(0.78 0.15 25)`, fontSize: `10px`, marginTop: `2px`}}>
            {info.incidentLabel}
          </div>
        </>
      ) : (
        <>
          <div className="tip-x">
            {info.dateStr} &middot; {info.scenarioTitle} &middot; {info.projectName}
          </div>
          {info.rows.map(r => {
            let nameStr = info.seriesMeta[r.id].name;
            let verEl: JSX.Element | null = null;
            if (info.showVersions) {
              if (r.id === `zpm`) {
                verEl = <span className="tip-ver"> main</span>;
              } else if (info.versionMap?.[r.id]) {
                verEl = <span className="tip-ver"> v{info.versionMap[r.id]}</span>;
              }
            }
            return (
              <div key={r.id} className="tip-row" style={{[`--c` as any]: SERIES_COLORS[r.id]}}>
                <span className="sw" />
                <span className="nm">{nameStr}{verEl}</span>
                <span className="vl">{r.value.toFixed(2)}s</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
