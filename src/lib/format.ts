/** Display helpers: file sizes, shot data, paths. */

export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
}

type Props = Record<string, unknown>;

function sub(props: Props, key: string): Props {
  const v = props[key];
  return v && typeof v === "object" ? (v as Props) : {};
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** A shutter speed reads as `1/250`, not `0.004`. */
export function formatExposure(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))} s`;
  return `1/${Math.round(1 / seconds)}`;
}

/** EXIF stores latitude as a positive number plus a separate N/S reference. */
function signedCoord(value: unknown, ref: unknown, negative: string): number | null {
  const v = num(value);
  if (v === null) return null;
  return str(ref)?.toUpperCase() === negative ? -v : v;
}

export interface Shot {
  make: string | null;
  model: string | null;
  lens: string | null;
  iso: number | null;
  exposure: string | null;
  aperture: string | null;
  focal: string | null;
  taken: string | null;
  gps: string | null;
}

/**
 * Pull the handful of fields worth a labelled row out of the ImageIO
 * dictionary. Everything else stays available under "all fields" — this only
 * decides what gets promoted.
 */
export function readShot(props: Props): Shot {
  const exif = sub(props, "Exif");
  const tiff = sub(props, "TIFF");
  const gps = sub(props, "GPS");

  const iso = Array.isArray(exif.ISOSpeedRatings)
    ? num((exif.ISOSpeedRatings as unknown[])[0])
    : num(exif.ISOSpeedRatings);

  const aperture = num(exif.FNumber);
  const focal = num(exif.FocalLength);

  const lat = signedCoord(gps.Latitude, gps.LatitudeRef, "S");
  const lon = signedCoord(gps.Longitude, gps.LongitudeRef, "W");

  return {
    make: str(tiff.Make),
    model: str(tiff.Model),
    lens: str(exif.LensModel) ?? str(exif.LensMake),
    iso,
    exposure: formatExposure(num(exif.ExposureTime)),
    aperture: aperture === null ? null : `ƒ/${Number(aperture.toFixed(1))}`,
    focal: focal === null ? null : `${Math.round(focal)} mm`,
    // EXIF dates look like "2026:05:14 18:03:22" — the colons in the date part
    // are not a typo, and no Date parser accepts them, so show it as written
    // with the separators swapped.
    taken: str(exif.DateTimeOriginal)?.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") ?? null,
    gps: lat !== null && lon !== null ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : null,
  };
}

/** Flatten the nested dictionary into `Section.Key → value` rows. */
export function flattenProps(props: Props): [string, string][] {
  const out: [string, string][] = [];
  const walk = (obj: Props, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v as Props, key);
      } else if (Array.isArray(v)) {
        out.push([key, v.join(", ")]);
      } else if (v !== null && v !== undefined) {
        out.push([key, String(v)]);
      }
    }
  };
  walk(props, "");
  out.sort((a, b) => a[0].localeCompare(b[0]));
  return out;
}
