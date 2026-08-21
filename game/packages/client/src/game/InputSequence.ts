export class RoundInputSequence {
  private roundIndex = -1
  private sequence = 0

  get current() {
    return this.sequence
  }

  enterRound(nextRoundIndex: number) {
    if (nextRoundIndex === this.roundIndex) return false
    this.roundIndex = nextRoundIndex
    this.sequence = 0
    return true
  }

  next() {
    this.sequence += 1
    return this.sequence
  }
}
