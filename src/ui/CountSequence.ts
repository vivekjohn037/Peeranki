/** Presentation only: never used to decide a shooter or advance a match. */
export class CountSequence {
  value = 0;
  private target = 0;
  private nextAt = 0;

  reset() { this.value = 0; this.target = 0; this.nextAt = 0; }
  receive(count: number) { this.target = Math.max(this.target, Math.min(10, Math.max(0, Math.floor(count)))); }
  advance(now: number): boolean {
    if (this.value >= this.target || now < this.nextAt) return false;
    this.value++;
    // Give every number a painted frame, even when Realtime delivers a batch.
    this.nextAt = now + (this.target - this.value > 2 ? 90 : 160);
    return true;
  }
  get caughtUp() { return this.value === this.target; }
}
