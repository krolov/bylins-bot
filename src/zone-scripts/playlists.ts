export interface ZonePlaylist {
  /** Must be >= 10000 to avoid collisions with zone IDs. */
  playlistId: number;
  playlistName: string;
  zoneIds: number[];
}

export const ZONE_PLAYLISTS: ZonePlaylist[] = [
  {
    playlistId: 10001,
    playlistName: "Три дороги (102 + 103 + 104)",
    zoneIds: [102, 103, 104],
  },
];
