import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Dashboard } from "@/components/dashboard/dashboard";
import { getToday } from "@/lib/dashboard/today";
import { dashboardTimeZone, isDateString, localDateString } from "@/lib/time/zone";

interface HomeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeProps) {
  // The date changes every day, so render per request.
  await connection();
  const param = (await searchParams).date;
  const requested = Array.isArray(param) ? param[0] : param;
  // Same rule as GET /api/today; a bad ?date= goes back to today with a clean URL.
  if (requested !== undefined && !isDateString(requested)) redirect("/");

  const now = new Date();
  const date = requested ?? localDateString(now, dashboardTimeZone());
  const today = await getToday(date, now);

  // Keyed by the URL's date: navigating between ?date= and today remounts the client tree with fresh state.
  return <Dashboard key={requested ?? "today"} initial={today} pinned={requested !== undefined} />;
}
