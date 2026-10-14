import { GlassPanel } from "@/components/ui/glass-panel";
import { SectionTitle } from "@/components/ui/typography";
import type { SprintDto, WorkCardDto } from "@/types/dashboard-contracts";

export interface WorkingOnProps {
  /** The one active sprint (D8), or null. */
  activeSprint: SprintDto | null;
  /** Non-archived cards in position order, each with its checklist items. */
  cards: WorkCardDto[];
}

/**
 * STUB — the Working on agent replaces the body (sprint header, cards with progress, checklist;
 * see sections/README.md). Keep the export name and props.
 */
export function WorkingOn({ activeSprint, cards }: WorkingOnProps) {
  const sprint = activeSprint
    ? `${activeSprint.name}${activeSprint.daysLeft === null ? "" : ` · ${activeSprint.daysLeft} days left`}`
    : "no active sprint";
  return (
    <GlassPanel aria-label="Working on" className="flex flex-col gap-[18px]">
      <SectionTitle>Working on</SectionTitle>
      <p className="m-0 text-[15px] text-text">
        Placeholder · {cards.length} {cards.length === 1 ? "card" : "cards"} · {sprint}
      </p>
    </GlassPanel>
  );
}
