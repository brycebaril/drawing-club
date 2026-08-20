import { notFound } from "next/navigation";
import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { SeriesMetadataEditForm } from "./SeriesMetadataEditForm";

interface SeriesDetail {
  id: string;
  name: string;
  seat_count: number;
}

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await pool.query<SeriesDetail>(`SELECT id, name, seat_count FROM series WHERE id = $1`, [id]);
  if (result.rowCount === 0) notFound();
  const series = result.rows[0];

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Edit series</h1>
      <SeriesMetadataEditForm seriesId={series.id} name={series.name} seatCount={series.seat_count} />
      <p>
        <Link href={`/admin/sessions/new-series?seriesId=${series.id}`}>+ Add more dates to this series</Link>
      </p>
    </main>
    </>
  );
}
