import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/typography";
import type { GmailSnapshot } from "@/types/dashboard-contracts";
import { capRows, formatClockOrDay } from "./format";

/** Rows shown per group; the rest collapse into "+N more" so the slide keeps a steady height. */
const ROWS_PER_GROUP = 4;

interface GroupProps {
  tone: "reply" | "packages" | "payments" | "deleted";
  count: number;
  label: string;
  /** Rows left out of the list, shown as "+N more". */
  hidden?: number;
  /** Muted line under the count (the Deleted group, and "None" for an empty list). */
  caption?: string;
  children?: ReactNode;
}

function Group({ tone, count, label, hidden = 0, caption, children }: GroupProps) {
  return (
    <div className={`banner-group banner-group--${tone}`}>
      <div className="banner-group__head">
        <span className="banner-group__count">{count}</span>
        <span className="banner-group__label">{label}</span>
      </div>
      {children}
      {hidden > 0 ? <span className="banner-group__caption">{`+${hidden} more`}</span> : null}
      {caption ? <span className="banner-group__caption">{caption}</span> : null}
    </div>
  );
}

export interface GmailSlideProps {
  data: GmailSnapshot;
  timeZone: string;
  now: Date;
}

/** Slide 2: four groups side by side. Payments carry merchant and time only, never amounts. */
export function GmailSlide({ data, timeZone, now }: GmailSlideProps) {
  const needsReply = capRows(data.needsReply, ROWS_PER_GROUP);
  const packages = capRows(data.packages, ROWS_PER_GROUP);
  const payments = capRows(data.payments, ROWS_PER_GROUP);
  const since = formatClockOrDay(new Date(data.since), now, timeZone);

  return (
    <>
      <Eyebrow>{since ? `Gmail · since ${since}` : "Gmail"}</Eyebrow>
      <div className="banner-gmail">
        <Group tone="reply" count={data.needsReply.length} label="Needs reply" hidden={needsReply.hidden} caption={data.needsReply.length === 0 ? "Nothing waiting" : undefined}>
          {needsReply.shown.length > 0 ? (
            <ul className="banner-rows">
              {needsReply.shown.map((mail, index) => {
                const text = (
                  <>
                    <span className="banner-row__main" title={mail.from}>
                      {mail.from}
                    </span>
                    <span className="banner-row__sub" title={mail.subject}>
                      {mail.subject}
                    </span>
                  </>
                );
                return (
                  <li key={index} className="banner-row">
                    {mail.threadUrl ? (
                      <a className="banner-row__text banner-row__link" href={mail.threadUrl} target="_blank" rel="noopener noreferrer">
                        {text}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="banner-row__text">{text}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </Group>

        <Group tone="packages" count={data.packages.length} label="Packages" hidden={packages.hidden} caption={data.packages.length === 0 ? "None on the way" : undefined}>
          {packages.shown.length > 0 ? (
            <ul className="banner-rows">
              {packages.shown.map((parcel, index) => (
                <li key={index} className="banner-row">
                  <span className="banner-row__text">
                    <span className="banner-row__main" title={parcel.label}>
                      {parcel.label}
                    </span>
                  </span>
                  <span className="banner-row__tag">{parcel.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Group>

        <Group tone="payments" count={data.payments.length} label="Payments" hidden={payments.hidden} caption={data.payments.length === 0 ? "None" : undefined}>
          {payments.shown.length > 0 ? (
            <ul className="banner-rows">
              {payments.shown.map((payment, index) => (
                <li key={index} className="banner-row">
                  <span className="banner-row__text">
                    <span className="banner-row__main" title={payment.merchant}>
                      {payment.merchant}
                    </span>
                  </span>
                  <time className="banner-row__tag" dateTime={payment.at}>
                    {formatClockOrDay(new Date(payment.at), now, timeZone)}
                  </time>
                </li>
              ))}
            </ul>
          ) : null}
        </Group>

        <Group tone="deleted" count={data.deletedCount} label="Deleted" caption={since ? `moved to trash since ${since}` : "moved to trash"} />
      </div>
    </>
  );
}
