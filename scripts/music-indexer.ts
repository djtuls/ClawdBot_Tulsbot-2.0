#!/usr/bin/env node
/**
 * music-indexer.ts — DJ Music Library → Vault
 *
 * Reads track metadata from:
 *   1. DJ.Studio SQLite database (BPM, key, analyzed data — preferred source)
 *   2. Filesystem scan (ID3 tags via ffprobe/exiftool — fallback)
 *
 * Generates:
 *   - One .md per track in 05_djtuls/tracks/
 *   - Genre MOC pages in 05_djtuls/genres/
 *   - 05_djtuls/_index.md with library stats
 *
 * Config: tuls-vault/08_system/sync-config.json (music-library.paths[])
 * State:  ~/.openclaw/state/music-indexer-state.json
 *
 * Usage:
 *   npx tsx scripts/music-indexer.ts              # incremental (new/changed only)
 *   npx tsx scripts/music-indexer.ts --full        # reindex everything
 *   npx tsx scripts/music-indexer.ts --dry-run     # preview counts only
 *   npx tsx scripts/music-indexer.ts --source=djstudio  # DJ.Studio DB only
 *   npx tsx scripts/music-indexer.ts --source=fs        # filesystem only
 *   npx tsx scripts/music-indexer.ts --limit=100   # process max N tracks
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname, basename, dirname } from "path";
import { execFileNoThrow } from "../src/utils/execFileNoThrow.js";
import { logCron, logError } from "./event-logger.js";

const VAULT = join(
  process.env.HOME!,
  "Library/Mobile Documents/iCloud~md~obsidian/Documents/tuls-vault",
);
const TRACKS_DIR = join(VAULT, "05_djtuls/tracks");
const GENRES_DIR = join(VAULT, "05_djtuls/genres");
const DJTULS_DIR = join(VAULT, "05_djtuls");
const SYNC_CONFIG_PATH = join(VAULT, "08_system/sync-config.json");
const STATE_PATH = join(process.env.HOME!, ".openclaw/state/music-indexer-state.json");
const DJSTUDIO_DB = join(process.env.HOME!, "Music/DJ.Studio/Database/studio.db");

const FULL = process.argv.includes("--full");
const DRY_RUN = process.argv.includes("--dry-run");
const SOURCE = process.argv.find((a) => a.startsWith("--source="))?.split("=")[1] || "both";
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1], 10) : Infinity;

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".aiff",
  ".aif",
  ".wav",
  ".m4a",
  ".ogg",
  ".opus",
]);

// --- Camelot wheel mapping (DJ.Studio integer key → Camelot notation) ---
// Derived from filenames in the library. Unmapped keys get raw number.
const KEY_INT_TO_CAMELOT: Record<number, string> = {
  0: "1A",
  1: "8B",
  2: "10B",
  3: "3B",
  4: "5B",
  5: "2B",
  6: "9B",
  7: "4B",
  8: "11B",
  9: "6B",
  10: "1B",
  11: "8A",
  12: "8A",
  13: "3A",
  14: "10A",
  15: "5A",
  16: "12A",
  17: "7A",
  18: "2A",
  19: "9A",
  20: "4A",
  21: "11A",
  22: "6A",
  23: "1A",
};

// Camelot → musical key notation
const CAMELOT_TO_KEY: Record<string, string> = {
  "1A": "Am",
  "2A": "Em",
  "3A": "Bm",
  "4A": "F#m",
  "5A": "Dbm",
  "6A": "Abm",
  "7A": "Ebm",
  "8A": "Bbm",
  "9A": "Fm",
  "10A": "Cm",
  "11A": "Gm",
  "12A": "Dm",
  "1B": "C",
  "2B": "G",
  "3B": "D",
  "4B": "A",
  "5B": "E",
  "6B": "B",
  "7B": "F#",
  "8B": "Db",
  "9B": "Ab",
  "10B": "Eb",
  "11B": "Bb",
  "12B": "F",
};

// --- Types ---

interface TrackMeta {
  id: string; // unique hash: slugified artist+title or file path
  filePath: string;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: string;
  bpm?: number;
  camelot?: string; // e.g. "8A"
  musicalKey?: string; // e.g. "Bbm"
  energy?: number; // 1-10 if available
  durationSec?: number;
  label?: string;
  source: "djstudio" | "filesystem";
  fileType: string; // mp3, flac, etc.
  folderContext?: string; // parent folder name (genre hint)
}

interface IndexState {
  lastRunAt: string;
  processedPaths: string[]; // file paths already indexed
}

// --- State ---

function loadState(): IndexState {
  if (!existsSync(STATE_PATH)) {
    return { lastRunAt: "", processedPaths: [] };
  }
  return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
}

function saveState(state: IndexState): void {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// --- DJ.Studio source ---

async function readDjStudioTracks(): Promise<TrackMeta[]> {
  if (!existsSync(DJSTUDIO_DB)) {
    return [];
  }

  const sqlite3 = await execFileNoThrow("sqlite3", [
    DJSTUDIO_DB,
    "-separator",
    "\t",
    "SELECT id, filePath, title, artist, genre, album, bpm, key, duration, label, releaseDate FROM Tracks;",
  ]);

  if (sqlite3.error || !sqlite3.stdout.trim()) {
    return [];
  }

  return sqlite3.stdout
    .trim()
    .split("\n")
    .map((line): TrackMeta | null => {
      const cols = line.split("\t");
      if (cols.length < 9) {
        return null;
      }

      const [
        id,
        filePath,
        title,
        artist,
        genre,
        album,
        bpmStr,
        keyStr,
        durStr,
        label,
        releaseDate,
      ] = cols;
      const bpm = parseInt(bpmStr, 10) || undefined;
      const keyInt = parseInt(keyStr, 10);
      const camelot = keyInt > 0 ? KEY_INT_TO_CAMELOT[keyInt] : undefined;
      const musicalKey = camelot ? CAMELOT_TO_KEY[camelot] : undefined;
      const durationSec = parseFloat(durStr) || undefined;
      const ext = extname(filePath).slice(1).toLowerCase();
      const folderContext = dirname(filePath).split("/").slice(-2).join(" / ");

      // Extract year from releaseDate
      const year = releaseDate ? releaseDate.slice(0, 4) : undefined;

      return {
        id: `djstudio-${id}`,
        filePath: filePath || "",
        title: title || basename(filePath, extname(filePath)),
        artist: artist || "Unknown",
        album: album || undefined,
        genre: genre || undefined,
        year,
        bpm,
        camelot,
        musicalKey,
        durationSec,
        label: label || undefined,
        source: "djstudio",
        fileType: ext,
        folderContext,
      };
    })
    .filter((t): t is TrackMeta => t !== null && Boolean(t.filePath));
}

// --- Filesystem source ---

async function readMetaFromFile(filePath: string): Promise<Partial<TrackMeta>> {
  // Try ffprobe first (most reliable for ID3)
  const ffprobe = await execFileNoThrow("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    filePath,
  ]);

  if (!ffprobe.error && ffprobe.stdout) {
    try {
      const data = JSON.parse(ffprobe.stdout);
      const tags = data.format?.tags || {};
      const durationSec = parseFloat(data.format?.duration) || undefined;
      const bpm = tags.BPM ? Math.round(parseFloat(tags.BPM)) : undefined;
      const keyTag = tags.INITIALKEY || tags.KEY || tags.key || tags.initialkey;
      const camelot = keyTag?.match(/^\d+[AB]$/) ? keyTag.toUpperCase() : undefined;
      const musicalKey = camelot ? CAMELOT_TO_KEY[camelot] : keyTag || undefined;

      return {
        title: tags.title || tags.TITLE || "",
        artist: tags.artist || tags.ARTIST || tags.TPE1 || "",
        album: tags.album || tags.ALBUM || "",
        genre: tags.genre || tags.GENRE || "",
        year: (tags.date || tags.YEAR || tags.DATE || "").slice(0, 4) || undefined,
        bpm,
        camelot,
        musicalKey,
        durationSec,
        label: tags.publisher || tags.PUBLISHER || tags.label || undefined,
      };
    } catch {}
  }

  // Fallback: exiftool
  const exiftool = await execFileNoThrow("exiftool", ["-json", filePath]);
  if (!exiftool.error && exiftool.stdout) {
    try {
      const [data] = JSON.parse(exiftool.stdout);
      const bpm = data.BPM ? Math.round(parseFloat(data.BPM)) : undefined;
      const keyTag = data.InitialKey || data.Key;
      const camelot = keyTag?.match(/^\d+[AB]$/) ? String(keyTag).toUpperCase() : undefined;
      return {
        title: data.Title || data.TrackTitle || "",
        artist: data.Artist || data.Performer || "",
        album: data.Album || "",
        genre: data.Genre || "",
        year: String(data.Year || data.RecordingYear || "").slice(0, 4) || undefined,
        bpm,
        camelot,
        musicalKey: camelot ? CAMELOT_TO_KEY[camelot] : undefined,
        durationSec: data.Duration ? parseFloat(data.Duration) : undefined,
        label: data.Publisher || data.Label || undefined,
      };
    } catch {}
  }

  return {};
}

async function scanFilesystem(paths: string[], processed: Set<string>): Promise<TrackMeta[]> {
  const tracks: TrackMeta[] = [];

  function walkDir(dir: string): string[] {
    const files: string[] = [];
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(".")) {
          continue;
        }
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          files.push(...walkDir(full));
        } else if (AUDIO_EXTENSIONS.has(extname(entry).toLowerCase())) {
          files.push(full);
        }
      }
    } catch {}
    return files;
  }

  for (const scanPath of paths) {
    if (!existsSync(scanPath)) {
      continue;
    }
    const files = walkDir(scanPath);

    for (const filePath of files) {
      if (processed.has(filePath)) {
        continue;
      }

      const ext = extname(filePath).slice(1).toLowerCase();
      const folderContext = dirname(filePath).split("/").slice(-2).join(" / ");
      const fileBase = basename(filePath, extname(filePath));

      // Try to parse BPM/key from filename (common DJ naming: "Artist - Title - 8A - 128.mp3")
      const bpmMatch = fileBase.match(/[-_\s](\d{2,3}(?:\.\d)?)\s*(?:bpm)?$/i);
      const keyMatch = fileBase.match(/[-_\s](\d{1,2}[AB])\s*[-_\s]/i);
      const filenameBpm = bpmMatch ? Math.round(parseFloat(bpmMatch[1])) : undefined;
      const filenameKey = keyMatch ? keyMatch[1].toUpperCase() : undefined;

      const meta = await readMetaFromFile(filePath);

      const title = meta.title || fileBase;
      const artist = meta.artist || "Unknown";

      tracks.push({
        id: `fs-${filePath.replace(/[^a-z0-9]/gi, "_").slice(-60)}`,
        filePath,
        title,
        artist,
        album: meta.album,
        genre: meta.genre,
        year: meta.year,
        bpm: meta.bpm || filenameBpm,
        camelot: meta.camelot || filenameKey,
        musicalKey:
          meta.camelot || filenameKey
            ? CAMELOT_TO_KEY[meta.camelot || filenameKey!]
            : meta.musicalKey,
        durationSec: meta.durationSec,
        label: meta.label,
        source: "filesystem",
        fileType: ext,
        folderContext,
      });
    }
  }

  return tracks;
}

// --- Slug builder ---

function buildTrackSlug(track: TrackMeta): string {
  const base = `${track.artist} - ${track.title}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
  return base || `track-${track.id.slice(-8)}`;
}

// --- Track → Markdown ---

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function buildTrackMarkdown(track: TrackMeta): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const duration = track.durationSec ? formatDuration(track.durationSec) : "";

  const tags = ["track"];
  if (track.genre) {
    tags.push(
      track.genre
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );
  }
  if (track.camelot) {
    tags.push(`key-${track.camelot.toLowerCase()}`);
  }

  // Infer mood/energy tags from genre + BPM
  const genreLower = (track.genre || "").toLowerCase();
  if (/techno|industrial|hard/.test(genreLower) || (track.bpm && track.bpm > 135)) {
    tags.push("high-energy");
  }
  if (/house|deep|minimal/.test(genreLower) && (!track.bpm || track.bpm < 130)) {
    tags.push("mid-energy");
  }
  if (/ambient|lounge|slow/.test(genreLower) || (track.bpm && track.bpm < 100)) {
    tags.push("low-energy");
  }
  if (/afro|latin|brasil|samba|salsa/.test(genreLower)) {
    tags.push("percussive");
  }
  if (/soul|funk|disco/.test(genreLower)) {
    tags.push("groovy");
  }

  const frontmatterLines = [
    "---",
    `title: "${`${track.artist} - ${track.title}`.replace(/"/g, "'")}"`,
    `source: music-library`,
    `origin: "${track.filePath}"`,
    `captured: ${now}`,
    `type: track`,
    `domain: djtuls`,
    `tags: ${JSON.stringify([...new Set(tags)])}`,
    `status: active`,
    `artist: "${track.artist.replace(/"/g, "'")}"`,
    `track_title: "${track.title.replace(/"/g, "'")}"`,
    track.album ? `album: "${track.album.replace(/"/g, "'")}"` : null,
    track.bpm ? `bpm: ${track.bpm}` : null,
    track.camelot ? `camelot: "${track.camelot}"` : null,
    track.musicalKey ? `key: "${track.musicalKey}"` : null,
    track.genre ? `genre: "${track.genre}"` : null,
    duration ? `duration: "${duration}"` : null,
    track.year ? `year: ${track.year}` : null,
    track.label ? `label: "${track.label.replace(/"/g, "'")}"` : null,
    `file_type: "${track.fileType}"`,
    `analyzed_by: "${track.source}"`,
    "sets: []",
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  // Build body
  const metaRows: string[] = [];
  if (track.bpm) {
    metaRows.push(`| BPM | ${track.bpm} |`);
  }
  if (track.camelot) {
    metaRows.push(`| Key (Camelot) | ${track.camelot} |`);
  }
  if (track.musicalKey) {
    metaRows.push(`| Key (Musical) | ${track.musicalKey} |`);
  }
  if (track.genre) {
    metaRows.push(`| Genre | ${track.genre} |`);
  }
  if (duration) {
    metaRows.push(`| Duration | ${duration} |`);
  }
  if (track.label) {
    metaRows.push(`| Label | ${track.label} |`);
  }
  if (track.year) {
    metaRows.push(`| Year | ${track.year} |`);
  }
  if (track.folderContext) {
    metaRows.push(`| Library Folder | ${track.folderContext} |`);
  }

  const metaTable = metaRows.length
    ? `## Metadata\n\n| Field | Value |\n| --- | --- |\n${metaRows.join("\n")}\n`
    : "";

  // Harmonic mixing suggestions based on Camelot
  const harmonicSuggestions = buildHarmonicSuggestions(track.camelot, track.bpm);

  const body = [
    `# ${track.artist} - ${track.title}`,
    "",
    metaTable,
    harmonicSuggestions ? `## Harmonic Mixing\n\n${harmonicSuggestions}\n` : "",
    "## Notes",
    "",
    "",
    "## Connections",
    "",
    "- ",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return `${frontmatterLines}\n\n${body}`;
}

function buildHarmonicSuggestions(camelot?: string, bpm?: number): string {
  if (!camelot) {
    return "";
  }
  const match = camelot.match(/^(\d+)([AB])$/);
  if (!match) {
    return "";
  }

  const num = parseInt(match[1], 10);
  const letter = match[2] as "A" | "B";

  // Perfect mix: same key ±1 number, same/opposite letter
  const compatibleKeys: string[] = [];
  compatibleKeys.push(`${num}A`);
  compatibleKeys.push(`${num}B`);
  if (num > 1) {
    compatibleKeys.push(`${num - 1}${letter}`);
  }
  if (num < 12) {
    compatibleKeys.push(`${num + 1}${letter}`);
  }
  // Energy boost: +1 semitone
  const boost = num === 12 ? "1" : String(num + 1);
  compatibleKeys.push(`${boost}${letter}`);

  const unique = [...new Set(compatibleKeys)].filter((k) => k !== camelot);
  const withKeys = unique.map((c) => `${c} (${CAMELOT_TO_KEY[c] || c})`).join(", ");

  const bpmNote = bpm
    ? `BPM range for mixing: ${Math.round(bpm * 0.94)}–${Math.round(bpm * 1.06)}`
    : "";

  return [`Compatible keys: ${withKeys}`, bpmNote].filter(Boolean).join("\n");
}

// --- Genre MOC pages ---

interface GenreGroup {
  name: string;
  tracks: TrackMeta[];
  avgBpm: number;
  keys: string[];
}

function buildGenreMoc(group: GenreGroup): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const slug = group.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const bpmRange = group.tracks
    .filter((t) => t.bpm)
    .reduce(
      (acc, t) => {
        acc.min = Math.min(acc.min, t.bpm!);
        acc.max = Math.max(acc.max, t.bpm!);
        return acc;
      },
      { min: Infinity, max: 0 },
    );

  const frontmatter = [
    "---",
    `title: "${group.name}"`,
    `source: thinking`,
    `captured: ${now}`,
    `type: topic`,
    `domain: djtuls`,
    `tags: ${JSON.stringify(["genre", slug])}`,
    `status: active`,
    `track_count: ${group.tracks.length}`,
    bpmRange.min !== Infinity ? `bpm_range: "${bpmRange.min}–${bpmRange.max}"` : null,
    `avg_bpm: ${Math.round(group.avgBpm) || "unknown"}`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const trackLines = group.tracks
    .toSorted((a, b) => (a.bpm || 0) - (b.bpm || 0))
    .slice(0, 100)
    .map((t) => {
      const parts = [`[[05_djtuls/tracks/${buildTrackSlug(t)}|${t.artist} - ${t.title}]]`];
      if (t.bpm) {
        parts.push(`${t.bpm} BPM`);
      }
      if (t.camelot) {
        parts.push(t.camelot);
      }
      return `- ${parts.join(", ")}`;
    });

  const uniqueKeys = [...new Set(group.tracks.filter((t) => t.camelot).map((t) => t.camelot!))]
    .toSorted()
    .map((c) => `${c} (${CAMELOT_TO_KEY[c] || c})`)
    .join(", ");

  const body = [
    `# ${group.name}`,
    "",
    `**${group.tracks.length} tracks** · BPM: ${bpmRange.min !== Infinity ? `${bpmRange.min}–${bpmRange.max}` : "varies"} · Avg: ${Math.round(group.avgBpm) || "?"}`,
    "",
    uniqueKeys ? `**Common keys:** ${uniqueKeys}` : "",
    "",
    "## Tracks",
    "",
    ...trackLines,
    group.tracks.length > 100 ? `\n*...and ${group.tracks.length - 100} more*` : "",
    "",
    "## Agent Notes",
    "",
    `*${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}: Auto-generated from music library index.*`,
    "",
    "## Connections",
    "",
    "- ",
  ]
    .filter((l) => l !== null)
    .join("\n");

  return `${frontmatter}\n\n${body}`;
}

// --- Library index ---

function buildDjTulsIndex(tracks: TrackMeta[], genreGroups: Map<string, GenreGroup>): string {
  const now = new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const withBpm = tracks.filter((t) => t.bpm);
  const avgBpm = withBpm.length
    ? Math.round(withBpm.reduce((s, t) => s + t.bpm!, 0) / withBpm.length)
    : 0;
  const bpmRange = withBpm.length
    ? `${Math.min(...withBpm.map((t) => t.bpm!))}–${Math.max(...withBpm.map((t) => t.bpm!))}`
    : "—";

  const genreTable = [...genreGroups.entries()]
    .toSorted(([, a], [, b]) => b.tracks.length - a.tracks.length)
    .slice(0, 20)
    .map(([name, g]) => {
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      return `| [[05_djtuls/genres/${slug}|${name}]] | ${g.tracks.length} | ${g.avgBpm ? Math.round(g.avgBpm) : "?"} |`;
    })
    .join("\n");

  return `---
title: "DJ Tuls Library Index"
type: index
domain: djtuls
updated: ${now}
track_count: ${tracks.length}
---

# DJ Tuls — Library Index

> **${tracks.length} tracks** · BPM range: ${bpmRange} · Avg BPM: ${avgBpm} · Updated: ${now}

---

## By Genre

| Genre | Tracks | Avg BPM |
| --- | --- | --- |
${genreTable}

---

## Sections

| Path | Contents |
| --- | --- |
| [[05_djtuls/tracks/]] | ${tracks.length} track notes with full metadata |
| [[05_djtuls/genres/]] | ${genreGroups.size} genre MOC pages |
| [[05_djtuls/sets/]] | DJ set lists with [[linked tracks]] |
| [[05_djtuls/techniques/]] | Mixing techniques and harmonic rules |

---

## Navigation Tips

- **Find tracks by key:** search \`qmd search --collection vault "8A 124 BPM"\`
- **Build a set:** ask Tulsbot "build a 2-hour deep house set 120–128 BPM harmonic mixing"
- **Find compatible tracks:** each track note lists compatible Camelot keys in **Harmonic Mixing** section

---

*Maintained by Tulsbot · Curated by Tulio*
`;
}

// --- Main ---

async function main() {
  const config = JSON.parse(readFileSync(SYNC_CONFIG_PATH, "utf-8"));
  const musicConfig = config["music-library"];

  if (!musicConfig.enabled && !FULL && SOURCE === "both") {
    console.log(
      "Music library indexer disabled in sync-config.json. Set enabled: true or use --full to run.",
    );
    return;
  }

  const state = loadState();
  const processed = new Set(FULL ? [] : state.processedPaths);

  console.log("Collecting tracks...");

  let tracks: TrackMeta[] = [];

  // DJ.Studio database (always check — it has analyzed data)
  if (SOURCE === "both" || SOURCE === "djstudio") {
    const djTracks = await readDjStudioTracks();
    console.log(`  DJ.Studio: ${djTracks.length} tracks`);
    tracks.push(...djTracks.filter((t) => FULL || !processed.has(t.filePath)));
  }

  // Filesystem scan (for tracks not in DJ.Studio)
  if (SOURCE === "both" || SOURCE === "fs") {
    const paths = musicConfig.paths?.length
      ? musicConfig.paths
      : [join(process.env.HOME!, "Documents/DJ Music")];

    // Skip paths already covered by DJ.Studio to avoid duplicates
    const djStudioPaths = new Set(tracks.map((t) => t.filePath));
    const fsPaths = paths.filter((p: string) => existsSync(p));

    if (fsPaths.length > 0) {
      console.log(`  Scanning filesystem: ${fsPaths.join(", ")}`);
      const fsTracks = await scanFilesystem(fsPaths, djStudioPaths);
      const newFsTracks = fsTracks.filter(
        (t) => !djStudioPaths.has(t.filePath) && (FULL || !processed.has(t.filePath)),
      );
      console.log(`  Filesystem (not in DJ.Studio): ${newFsTracks.length} new tracks`);
      tracks.push(...newFsTracks);
    }
  }

  if (!tracks.length) {
    console.log("No new tracks to index.");
    logCron("music-indexer", "ok", { indexed: 0, mode: FULL ? "full" : "incremental" });
    return;
  }

  // Apply limit
  if (tracks.length > LIMIT) {
    console.log(`Limiting to ${LIMIT} tracks (${tracks.length} total new)`);
    tracks = tracks.slice(0, LIMIT);
  }

  console.log(`\nIndexing ${tracks.length} tracks...`);

  if (DRY_RUN) {
    console.log("[dry-run] Would generate:");
    console.log(`  - ${tracks.length} track notes in 05_djtuls/tracks/`);
    const genres = new Set(tracks.map((t) => t.genre).filter(Boolean));
    console.log(`  - ${genres.size} genre MOC pages`);
    console.log(`  - 05_djtuls/_index.md`);
    return;
  }

  mkdirSync(TRACKS_DIR, { recursive: true });
  mkdirSync(GENRES_DIR, { recursive: true });

  // Write track notes
  let written = 0;
  let errors = 0;
  const genreMap = new Map<string, GenreGroup>();

  for (const track of tracks) {
    try {
      const slug = buildTrackSlug(track);
      const markdown = buildTrackMarkdown(track);
      const outPath = join(TRACKS_DIR, `${slug}.md`);

      // Don't overwrite existing notes (preserve manual edits)
      if (!existsSync(outPath) || FULL) {
        writeFileSync(outPath, markdown, "utf-8");
        written++;
      }

      processed.add(track.filePath);

      // Accumulate genre data
      const genreName = track.genre || "Uncategorized";
      if (!genreMap.has(genreName)) {
        genreMap.set(genreName, { name: genreName, tracks: [], avgBpm: 0, keys: [] });
      }
      const group = genreMap.get(genreName)!;
      group.tracks.push(track);
      if (track.camelot) {
        group.keys.push(track.camelot);
      }
    } catch (e) {
      errors++;
      if (errors <= 5) {
        console.error(`  Error: ${track.artist} - ${track.title}: ${e}`);
      }
    }
  }

  // Calculate avg BPM per genre
  for (const group of genreMap.values()) {
    const bpmTracks = group.tracks.filter((t) => t.bpm);
    group.avgBpm = bpmTracks.length
      ? bpmTracks.reduce((s, t) => s + t.bpm!, 0) / bpmTracks.length
      : 0;
  }

  // Write genre MOC pages
  let genresWritten = 0;
  for (const [genreName, group] of genreMap.entries()) {
    if (group.tracks.length === 0) {
      continue;
    }
    const slug = genreName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const outPath = join(GENRES_DIR, `${slug}.md`);

    // Always rebuild genre pages to reflect latest track list
    writeFileSync(outPath, buildGenreMoc(group), "utf-8");
    genresWritten++;
  }

  // Rebuild the full library for _index.md (need all tracks, not just new ones)
  // Read all existing track metadata for complete stats
  const allProcessedCount = processed.size;
  const djStudioTotal = SOURCE !== "fs" ? (await readDjStudioTracks()).length : 0;
  const allTracks = SOURCE !== "fs" ? await readDjStudioTracks() : tracks;
  const allGenreMap = new Map<string, GenreGroup>();
  for (const track of allTracks) {
    const g = track.genre || "Uncategorized";
    if (!allGenreMap.has(g)) {
      allGenreMap.set(g, { name: g, tracks: [], avgBpm: 0, keys: [] });
    }
    allGenreMap.get(g)!.tracks.push(track);
  }
  for (const group of allGenreMap.values()) {
    const bpmTracks = group.tracks.filter((t) => t.bpm);
    group.avgBpm = bpmTracks.length
      ? bpmTracks.reduce((s, t) => s + t.bpm!, 0) / bpmTracks.length
      : 0;
  }

  // Write library index
  writeFileSync(join(DJTULS_DIR, "_index.md"), buildDjTulsIndex(allTracks, allGenreMap), "utf-8");

  // Save state
  state.lastRunAt = new Date().toISOString();
  state.processedPaths = [...processed];
  saveState(state);

  console.log(`\nDone:`);
  console.log(`  ✓ ${written} track notes written`);
  console.log(`  ✓ ${genresWritten} genre pages built`);
  console.log(`  ✓ _index.md updated`);
  if (errors) {
    console.log(`  ✗ ${errors} errors`);
  }

  logCron("music-indexer", errors > 0 ? "warn" : "ok", {
    mode: FULL ? "full" : "incremental",
    written,
    genresWritten,
    errors,
    totalInState: processed.size,
  });
}

main().catch((e) => {
  logError("music-indexer", String(e));
  console.error(e);
  process.exit(1);
});
