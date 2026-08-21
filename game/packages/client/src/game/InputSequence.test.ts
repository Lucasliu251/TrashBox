import { describe, expect, it } from 'vitest'
import { RoundInputSequence } from './InputSequence'

describe('round input sequencing', () => {
  it('restarts from one whenever the server rotates to a new round', () => {
    const sequence = new RoundInputSequence()
    expect(sequence.enterRound(0)).toBe(true)
    expect(sequence.next()).toBe(1)
    for (let index = 0; index < 900; index += 1) sequence.next()
    expect(sequence.enterRound(1)).toBe(true)
    expect(sequence.current).toBe(0)
    expect(sequence.next()).toBe(1)
  })

  it('does not reset for repeated snapshots of the same round', () => {
    const sequence = new RoundInputSequence()
    sequence.enterRound(2)
    sequence.next()
    expect(sequence.enterRound(2)).toBe(false)
    expect(sequence.current).toBe(1)
  })
})
