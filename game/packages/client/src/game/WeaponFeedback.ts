export interface ReloadPose {
  weaponAmount: number
  magazineAmount: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => {
  const clamped = clamp01(value)
  return clamped * clamped * (3 - 2 * clamped)
}

/** A four-stage lower, remove, insert and shoulder animation curve. */
export function reloadPose(progress: number): ReloadPose {
  const value = clamp01(progress)
  const weaponAmount = value < 0.18
    ? smooth(value / 0.18)
    : value > 0.82
      ? smooth((1 - value) / 0.18)
      : 1
  const magazineAmount = value < 0.24
    ? 0
    : value < 0.42
      ? smooth((value - 0.24) / 0.18)
      : value < 0.58
        ? 1
        : value < 0.78
          ? smooth((0.78 - value) / 0.2)
          : 0
  return { weaponAmount, magazineAmount }
}
