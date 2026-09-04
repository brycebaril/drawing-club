/**
 * One-off asset-prep script — not wired into package.json, run manually
 * via `pnpm exec tsx scripts/prep-photos.ts` from the repo root. Produces
 * the shipped public/photos/* files from the raw camera originals per
 * photography-brief-for-claude-code.md. Kept committed (not deleted after
 * running) as a record of exactly how each shipped file was derived,
 * matching this repo's other one-off-script convention
 * (scripts/migrate-legacy-data.ts).
 *
 * Only 4 of the 5 source photos are processed. studio_from_stage.jpg
 * (the brief's photo #4, "from-the-platform.jpg") is deliberately left
 * alone — it contains painted nudes in the background that have never
 * been given a safety crop, and no page exists yet to host it (see
 * CLAUDE.md / the photography plan for the full reasoning). Do not add
 * it here without a real crop AND a real destination page.
 */
import sharp from "sharp";
import path from "node:path";
import { mkdirSync } from "node:fs";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "public", "photos");

async function main() {
  mkdirSync(OUT, { recursive: true });

  // #1 studio_empty.jpg -> studio-room.jpg (homepage hero)
  // No pixel crop — the wall-pinned figure studies read as thumbnail-scale
  // and indistinct at this distance (unlike #3's large individually-mounted
  // paintings), matching the brief's own scoping (it does not list this
  // photo under the nudity caveat). Framing toward the platform/drawing
  // wall is handled at render time via next/image `fill` + object-position.
  // Re-encode only, so we don't commit a raw multi-MB camera JPEG.
  await sharp(path.join(ROOT, "studio_empty.jpg"))
    .resize({ width: 3200, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(path.join(OUT, "studio-room.jpg"));

  // #2 basic-over-artist.png -> drawing-in-progress.jpg (About page inset)
  // Real crop: trims the bottom band the brief says carries a video-player
  // UI artifact, and tightens slightly toward the hand/paper since this is
  // the lowest-res source file (854x1322 native). Re-check the exact
  // artifact height against the source before treating this as final.
  await sharp(path.join(ROOT, "basic-over-artist.png"))
    .extract({ left: 0, top: 0, width: 854, height: 1216 })
    .resize({ width: 600, withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(path.join(OUT, "drawing-in-progress.jpg"));

  // #3 studio-walls.jpg -> exhibition-wall.jpg (News page accent)
  // Real crop, non-negotiable, visually verified against the actual photo:
  // the door + "FIGURATIVE ART EXHIBITION" poster sit at roughly
  // x=260-750 of the 4032px width; the cluster of small black-framed
  // pencil/etching studies (fine to include per the brief) spans roughly
  // x=1230-2280; the large individually-mounted COLOR paintings with
  // visible nudity begin at roughly x=2480 and continue to the right edge.
  // width=2350 (~58% of 4032, full height) keeps a real ~130px safety
  // margin between the rightmost small drawing and the first large
  // painting, while including everything the brief wants visible.
  await sharp(path.join(ROOT, "studio-walls.jpg"))
    .extract({ left: 0, top: 0, width: 2350, height: 3024 })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(path.join(OUT, "exhibition-wall.jpg"));

  // #4 studio_from_stage.jpg -> DEFERRED, see file header. Not processed.

  // #5 studio_lighting_reference.jpg -> cast-head.jpg (schedule/wallet accent)
  // Visually confirmed clean (plaster head, blurred kitchen background, no
  // people, no artwork) — downsize only, no crop.
  await sharp(path.join(ROOT, "studio_lighting_reference.jpg"))
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(path.join(OUT, "cast-head.jpg"));

  console.log("Wrote public/photos/: studio-room.jpg, drawing-in-progress.jpg, exhibition-wall.jpg, cast-head.jpg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
