const SOURCES = [
  { name: "github", color: "bg-source-github" },
  { name: "hermes", color: "bg-source-hermes" },
  { name: "gmail", color: "bg-source-gmail" },
  { name: "seerr", color: "bg-source-seerr" },
  { name: "pipeline", color: "bg-source-pipeline" },
] as const;

export function SourceLegend() {
  return (
    <ul
      aria-label="Source colors"
      className="m-0 flex list-none flex-wrap gap-3.5 border border-ink-light bg-[rgba(14,26,31,0.6)] px-3.5 py-2.5 font-mono text-[12px] leading-normal text-text"
    >
      {SOURCES.map((source) => (
        <li key={source.name} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={`size-2 ${source.color}`} />
          {source.name}
        </li>
      ))}
    </ul>
  );
}
