const SOURCES = [
  { name: "github", color: "bg-source-github" },
  { name: "hermes", color: "bg-source-hermes" },
  { name: "gmail", color: "bg-source-gmail" },
  { name: "seerr", color: "bg-source-seerr" },
  { name: "pipeline", color: "bg-source-pipeline" },
] as const;

export function SourceLegend() {
  return (
    <ul aria-label="Source colors" className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-text-muted">
      {SOURCES.map((source) => (
        <li key={source.name} className="flex items-center gap-2">
          <span aria-hidden="true" className={`size-2 ${source.color}`} />
          {source.name}
        </li>
      ))}
    </ul>
  );
}
