---
name: zone-painting
description: "Use when the user wants to color/paint map zones or rooms. Examples: \"покрась зону\", \"добавь цвет для зоны\", \"set zone colors\", \"paint zone 270\""
---

# Zone Painting — How to Color Map Zones

Map zones are painted via the `room_colors` PostgreSQL table. There is no UI for this — all color edits go through SQL.

## How It Works

### Storage

```
room_colors (vnum INTEGER PK, color TEXT NOT NULL)
```

Each row assigns a hex color to one room vnum. The color appears on the map tile.

In `getSnapshot()` in `src/map/store.ts`:

```sql
SELECT r.vnum, ..., COALESCE(c.color, r.color) AS color
FROM map_rooms r
LEFT JOIN room_colors c ON c.vnum = r.vnum
```

`room_colors` overrides any color stored in `map_rooms.color`. Always write to `room_colors` — never edit `map_rooms.color` directly.

### Rendering

In `src/client.ts`, every non-current room tile applies the color as CSS `background`:

```ts
if (!isCurrent && node.color) {
  tile.style.background = node.color;
}
```

Colors are visible immediately after a map snapshot refresh.

---

## Zone ID Formula

```
zone_id = Math.floor(vnum / 100)
```

Zone 286 = vnums 28600–28699. Zone 45 = vnums 4500–4599.

---

## Database Connection

```bash
DATABASE_URL=postgres://bylins:bylins@localhost:5432/bylins_bot
```

Or read it from PM2: `pm2 env 3 | grep DATABASE_URL`

All SQL examples below use `psql "$DATABASE_URL"`.

---

## Painting a New Zone

### Step 1 — Find room vnums

```sql
SELECT vnum, name FROM map_rooms
WHERE FLOOR(vnum::float / 100) = <zone_id>
ORDER BY vnum;
```

Check total coverage:

```sql
SELECT COUNT(*) FROM map_rooms WHERE FLOOR(vnum::float / 100) = <zone_id>;
```

### Step 2 — Choose colors

Pick from the existing palette (dark, muted tones that suit the terrain):

| Terrain type | Recommended colors |
|---|---|
| Forest / woods | `#1e4a20`, `#2e6635`, `#4a8a4a`, `#3a6e28`, `#406830` |
| Road / path | `#6b4d2a`, `#7a5c40`, `#5a5030`, `#6e5430` |
| River / water | `#2a6080`, `#2a5878`, `#384a5a`, `#3a6068`, `#485e72` |
| Fields / steppe | `#5a8a38`, `#6a9228`, `#709030`, `#72b030` |
| Stone / ruins | `#6a6a6a`, `#4e6058`, `#524270` |
| Dark interior | `#501e1e`, `#6e2828`, `#4c3a18` |
| Mixed / village | `#8a6e3a`, `#6a5e48`, `#6e5a42` |

Pick 1–3 colors per zone max. Use fewer colors for roads (1 is fine), more for complex zones with distinct sub-areas.

### Step 3 — Paint all rooms one color (simple zone)

```sql
INSERT INTO room_colors (vnum, color)
SELECT vnum, '#6b4d2a'
FROM map_rooms
WHERE FLOOR(vnum::float / 100) = <zone_id>
ON CONFLICT (vnum) DO UPDATE SET color = EXCLUDED.color;
```

### Step 4 — Paint sub-areas (multi-color zone)

First paint the whole zone with the dominant color, then override specific vnum ranges:

```sql
-- Dominant color for entire zone
INSERT INTO room_colors (vnum, color)
SELECT vnum, '#6b4d2a'
FROM map_rooms WHERE FLOOR(vnum::float / 100) = 286
ON CONFLICT (vnum) DO UPDATE SET color = EXCLUDED.color;

-- Override river rooms
INSERT INTO room_colors (vnum, color)
VALUES (28640, '#2a6080'), (28641, '#2a6080'), (28642, '#2a6080')
ON CONFLICT (vnum) DO UPDATE SET color = EXCLUDED.color;

-- Override stone ruins
INSERT INTO room_colors (vnum, color)
VALUES (28660, '#6a6a6a'), (28661, '#6a6a6a')
ON CONFLICT (vnum) DO UPDATE SET color = EXCLUDED.color;
```

---

## Inspecting an Existing Zone

See what colors a zone already has:

```sql
SELECT vnum, color FROM room_colors
WHERE FLOOR(vnum::float / 100) = <zone_id>
ORDER BY vnum;
```

Summary by color:

```sql
SELECT color, COUNT(*) AS rooms
FROM room_colors
WHERE FLOOR(vnum::float / 100) = <zone_id>
GROUP BY color ORDER BY rooms DESC;
```

---

## Checking Coverage

How many rooms are painted vs total:

```sql
SELECT
  total.cnt AS total_rooms,
  COALESCE(painted.cnt, 0) AS painted_rooms
FROM (
  SELECT COUNT(*) AS cnt FROM map_rooms WHERE FLOOR(vnum::float / 100) = <zone_id>
) total
LEFT JOIN (
  SELECT COUNT(*) AS cnt FROM room_colors WHERE FLOOR(vnum::float / 100) = <zone_id>
) painted ON TRUE;
```

---

## All Painted Zones (reference)

```sql
SELECT
  FLOOR(vnum::float/100) AS zone_id,
  COUNT(*) AS painted_rooms,
  COUNT(DISTINCT color) AS color_count,
  array_agg(DISTINCT color) AS colors
FROM room_colors
GROUP BY zone_id
ORDER BY zone_id;
```

---

## Removing Colors

Remove all colors from a zone:

```sql
DELETE FROM room_colors WHERE FLOOR(vnum::float / 100) = <zone_id>;
```

Remove color from specific vnums:

```sql
DELETE FROM room_colors WHERE vnum IN (28640, 28641, 28642);
```

---

## Existing Color Palette (all 47 colors in use)

```
Forest dark:   #1e4a20  #2a6020  #2e6635  #3a6828  #3a6e28  #3a7830  #406830
Forest mid:    #4a8a4a  #5a8a38  #6a9228  #6a9a3a  #709030  #72a028  #72b030
Road/earth:    #3e3010  #4a3a10  #4c3a18  #524018  #5a5030  #5c5018  #6a3a18
Road/wood:     #6a5228  #6b4d2a  #6e5430  #6e5a42  #7a5c40  #705438  #845a28
Fields/mix:    #6a5e48  #6a5840  #8a6e3a
Water:         #2a5878  #2a6080  #384a5a  #3a6068  #485e72  #524270
Dark stone:    #4e3e20  #4e6058  #6a6a6a
Danger/blood:  #501e1e  #5e3818  #6a4228  #6a4848  #6e2828
```

---

## Real Example: Zone 286 "Бобры и плотина"

95 rooms, 11 colors — the most detailed painted zone.

```sql
-- Check existing distribution
SELECT color, COUNT(*) FROM room_colors
WHERE FLOOR(vnum::float/100) = 286
GROUP BY color ORDER BY COUNT(*) DESC;
```

Result shows: `#5a5030` (30 rooms, dirt path), `#2a6080` (13 rooms, river), `#8a6e3a` (11 rooms, mixed), `#2e6635` (9 rooms, forest), etc.

---

## Workflow Summary

1. Find zone_id from `zone_names` or `FLOOR(vnum/100)`
2. Count rooms: `SELECT COUNT(*) FROM map_rooms WHERE FLOOR(vnum::float/100) = <zone_id>`
3. Choose 1–3 hex colors matching terrain
4. Paint dominant color for all rooms with INSERT...SELECT + ON CONFLICT
5. Override sub-areas with individual vnums if needed
6. Verify: `SELECT color, COUNT(*) FROM room_colors WHERE FLOOR(vnum::float/100) = <zone_id> GROUP BY color`
7. Refresh map in browser to see result (map auto-updates on next snapshot)
