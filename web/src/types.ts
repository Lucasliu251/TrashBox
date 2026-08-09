export type RadarStatus = 'in_match' | 'in_cs2' | 'online' | 'offline' | 'unknown'

export interface RiskSignal {
  code: string
  severity: 'high' | 'medium' | 'info'
  label: string
}

export interface RadarTarget {
  id: number
  steam_id: string
  alias: string | null
  tags: string[]
  note: string | null
  manual_cs_level: number | null
  service_medal: 'unknown' | 'yes' | 'no'
  status: RadarStatus | null
  personaname: string | null
  avatar_url: string | null
  profile_url: string | null
  game_extra_info: string | null
  group_key: string | null
  cs2_playtime_minutes: number | null
  risk_signals: RiskSignal[]
  observed_at: string | null
}

export interface RadarSession {
  id: string
  status: string
  started_at: string
  expires_at: string
  last_tick_at: string | null
  error_summary: string | null
}

export interface ResolvedTarget {
  steam_id: string
  personaname: string
  avatar_url: string | null
  profile_url: string
}
