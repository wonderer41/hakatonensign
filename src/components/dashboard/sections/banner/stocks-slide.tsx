import { Eyebrow } from "@/components/ui/typography";
import type { StocksSnapshot } from "@/types/dashboard-contracts";
import { chunk, formatChange, formatPrice, sameCurrency } from "./format";

/** 4 columns of 3 rows. */
const ROWS_PER_COLUMN = 3;
const MAX_ROWS = 12;

function Change({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <td className="banner-change banner-change--flat">
        <span aria-hidden="true">—</span>
        <span className="sr-only">no data yet</span>
      </td>
    );
  }
  const change = formatChange(pct);
  return (
    <td className={`banner-change banner-change--${change.direction}`}>
      <span aria-hidden="true">{change.text}</span>
      <span className="sr-only">{change.spoken}</span>
    </td>
  );
}

export interface StocksSlideProps {
  data: StocksSnapshot;
}

/** Slide 4: Symbol · Price · Day · 6M. Up = ▲ +x.x% (green), down = ▼ −x.x% (red); the sign and arrow carry the meaning. */
export function StocksSlide({ data }: StocksSlideProps) {
  const rows = data.rows.slice(0, MAX_ROWS);
  const omitted = data.rows.length - rows.length;
  // One currency for every row is stated once in the header; mixed currencies are tagged per row.
  const currency = sameCurrency(rows);
  const columns = chunk(rows, ROWS_PER_COLUMN);

  return (
    <>
      <div className="banner-split-head">
        <Eyebrow>Stocks</Eyebrow>
        <p className="banner-meta">
          {currency ? `prices in ${currency} · day · 6 months` : "price · day · 6 months"}
          {omitted > 0 ? ` · +${omitted} not shown` : ""}
        </p>
      </div>
      <div className="banner-stocks">
        {columns.map((column, columnIndex) => {
          const first = columnIndex * ROWS_PER_COLUMN + 1;
          return (
            <table key={columnIndex} className="banner-stocks__table" aria-label={`Stocks ${first} to ${first + column.length - 1} of ${rows.length}`}>
              <thead>
                <tr>
                  <th scope="col" className="banner-stocks__symbol">
                    Symbol
                  </th>
                  <th scope="col">Price</th>
                  <th scope="col">
                    Day<span className="sr-only"> change</span>
                  </th>
                  <th scope="col">
                    6M<span className="sr-only"> change, six months</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {column.map((row) => (
                  <tr key={row.symbol}>
                    <th scope="row" className="banner-stocks__symbol" title={row.symbol}>
                      {row.symbol}
                      {currency ? null : <span className="banner-stocks__currency">{row.currency}</span>}
                    </th>
                    <td className="banner-stocks__price">{formatPrice(row.price)}</td>
                    <Change pct={row.dayChangePct} />
                    <Change pct={row.sixMonthChangePct} />
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })}
      </div>
    </>
  );
}
