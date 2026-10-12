import { connection } from "next/server";
import { Header } from "@/components/header";
import { dashboardTimeZone, formatEyebrowDate } from "@/lib/time/zone";

export default async function Home() {
  // The date changes every day, so render per request.
  await connection();
  const eyebrow = formatEyebrowDate(new Date(), dashboardTimeZone());

  return (
    <main className="mx-auto flex max-w-[1360px] flex-col gap-7 px-[clamp(16px,4vw,48px)] py-10">
      <Header eyebrow={eyebrow} />
    </main>
  );
}
