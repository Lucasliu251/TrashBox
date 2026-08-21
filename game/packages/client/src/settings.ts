import { cmPer360, edpi } from '@trashbox/sniper-shared'

export interface TrainingSettings {
  name: string
  dpi: number
  sensitivity: number
  zoomSensitivity: number
  reducedViolence: boolean
}

const SETTINGS_KEY = 'blackline.settings.v1'

export const defaultSettings: TrainingSettings = {
  name: 'Operator',
  dpi: 800,
  sensitivity: 1,
  zoomSensitivity: 1,
  reducedViolence: false,
}

export function readSettings(): TrainingSettings {
  try {
    return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return { ...defaultSettings }
  }
}

export function saveSettings(settings: TrainingSettings) {
  const safe = {
    ...settings,
    name: settings.name.trim().slice(0, 16) || defaultSettings.name,
    dpi: Math.min(32000, Math.max(100, Number(settings.dpi) || defaultSettings.dpi)),
    sensitivity: Math.min(10, Math.max(0.01, Number(settings.sensitivity) || defaultSettings.sensitivity)),
    zoomSensitivity: Math.min(3, Math.max(0.1, Number(settings.zoomSensitivity) || defaultSettings.zoomSensitivity)),
  }
  Object.assign(settings, safe)
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(safe))
}

export function sensitivitySummary(settings: TrainingSettings) {
  return {
    edpi: edpi(settings.dpi, settings.sensitivity),
    cm360: cmPer360(settings.dpi, settings.sensitivity),
  }
}
