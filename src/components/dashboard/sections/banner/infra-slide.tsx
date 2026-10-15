import { Eyebrow } from "@/components/ui/typography";
import type { OrphansSnapshot, ScanSnapshot } from "@/types/dashboard-contracts";
import { capRows, formatClockOrDay, plural } from "./format";

/** Orphan names shown (the list is two or three columns wide); the rest collapse into "+N more". */
const ORPHANS_SHOWN = 12;
const ISSUES_SHOWN = 4;

function OrphansPanel({ data }: { data: OrphansSnapshot | null }) {
  if (!data) {
    return (
      <div className="banner-orphans" role="group" aria-label="Orphans, manual review">
        <Eyebrow>Orphans · manual review</Eyebrow>
        <p className="banner-muted">No orphan report yet.</p>
      </div>
    );
  }
  const total = data.counts.sonarr + data.counts.radarr;
  const names = capRows(data.items, ORPHANS_SHOWN);
  return (
    <div className="banner-orphans" role="group" aria-label="Orphans, manual review">
      <div className="banner-split-head">
        <Eyebrow>Orphans · manual review</Eyebrow>
        <p className="banner-meta">{`${plural(total, "item")} · sonarr ${data.counts.sonarr} · radarr ${data.counts.radarr}`}</p>
      </div>
      {names.shown.length > 0 ? (
        <>
          <ul className="banner-orphans__list">
            {names.shown.map((item, index) => (
              <li key={index} className="banner-orphans__item">
                <span aria-hidden="true" className="banner-orphans__mark" />
                <span className="banner-orphans__name" title={item.name}>
                  {item.name}
                </span>
              </li>
            ))}
          </ul>
          {names.hidden > 0 ? <p className="banner-muted">{`+${names.hidden} more`}</p> : null}
        </>
      ) : (
        <p className="banner-muted">Nothing to review.</p>
      )}
    </div>
  );
}

function ScanPanel({ data, now, timeZone }: { data: ScanSnapshot | null; now: Date; timeZone: string }) {
  if (!data) {
    return (
      <div className="banner-scan" role="group" aria-label="Daily scan">
        <Eyebrow>Daily scan</Eyebrow>
        <p className="banner-muted">No scan yet.</p>
      </div>
    );
  }
  const ranAt = formatClockOrDay(new Date(data.ranAt), now, timeZone);
  // A scan can report containers down without naming them; count those as issues too.
  const problems = Math.max(data.issues.length, data.total - data.up);
  const issues = capRows(data.issues, ISSUES_SHOWN);
  return (
    <div className="banner-scan" role="group" aria-label="Daily scan">
      <Eyebrow>{ranAt ? `Daily scan · ${ranAt}` : "Daily scan"}</Eyebrow>
      <div className="banner-scan__status">
        <span className={`banner-scan__headline ${problems > 0 ? "banner-scan__headline--issue" : "banner-scan__headline--ok"}`}>
          {problems > 0 ? plural(problems, "issue") : "All up"}
        </span>
        <span className="banner-scan__count">{`${data.up} / ${data.total} up`}</span>
      </div>
      {issues.shown.length > 0 ? (
        <ul className="banner-scan__issues">
          {issues.shown.map((issue, index) => (
            <li key={index} className="banner-scan__issue">
              <span aria-hidden="true" className="banner-scan__mark" />
              <span className="banner-scan__container">{issue.container}</span>
              <span className="banner-scan__summary">{issue.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {issues.hidden > 0 ? <p className="banner-muted">{`+${issues.hidden} more`}</p> : null}
    </div>
  );
}

export interface InfraSlideProps {
  orphans: OrphansSnapshot | null;
  scan: ScanSnapshot | null;
  timeZone: string;
  now: Date;
}

/** Slide 3: orphans on the left (2/3), the daily scan on the right (1/3). */
export function InfraSlide({ orphans, scan, timeZone, now }: InfraSlideProps) {
  return (
    <div className="banner-infra">
      <OrphansPanel data={orphans} />
      <ScanPanel data={scan} now={now} timeZone={timeZone} />
    </div>
  );
}
