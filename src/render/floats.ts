/**
 * A growable list of floats that is a `Float32Array` all along.
 *
 * Every mesh in this world is built by pushing numbers into an array and
 * handing the array to Three, which copies it into a `Float32Array`. That is
 * two costs nobody meant to pay: a JavaScript array of numbers is eight bytes
 * a number and a pile of bookkeeping, and the copy means both exist at once.
 * The city is ten million vertices, so the walls alone were three hundred
 * megabytes of temporary array on the way to a hundred and twenty of buffer.
 *
 * It matters because of what kills a tab. The steady state was never the
 * problem -- the world sits in about four hundred megabytes -- but the rubbish
 * left behind by building it went past a gigabyte, and a browser that decides
 * a page is too big decides it at the peak. Safari killed one.
 *
 * So: write straight into a `Float32Array`, doubling it when it fills, and
 * hand back a view of exactly what was written. The doubling costs one copy
 * of what has been written so far, which is still less than what the plain
 * array cost before anything was copied at all.
 */

export class Floats {
  private data: Float32Array;
  private at = 0;

  constructor(expected = 1024) {
    this.data = new Float32Array(Math.max(16, expected));
  }

  /** How many have been written. */
  get length(): number {
    return this.at;
  }

  private room(more: number) {
    if (this.at + more <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.at + more) size *= 2;
    const grown = new Float32Array(size);
    grown.set(this.data.subarray(0, this.at));
    this.data = grown;
  }

  push(value: number): void {
    this.room(1);
    this.data[this.at] = value;
    this.at += 1;
  }

  /** The usual case: a point, a normal, a colour. */
  push3(a: number, b: number, c: number): void {
    this.room(3);
    this.data[this.at] = a;
    this.data[this.at + 1] = b;
    this.data[this.at + 2] = c;
    this.at += 3;
  }

  /**
   * What was written, as a view rather than a copy where it can be.
   *
   * Three keeps whatever it is given, so an array with room to spare would
   * keep that room for the life of the page. A view of a buffer that is
   * mostly slack does too -- so it is copied when more than an eighth of it
   * is waste, and handed over as it stands when it is not.
   */
  take(): Float32Array {
    if (this.at === this.data.length) return this.data;
    if (this.data.length - this.at > this.data.length / 8) return this.data.slice(0, this.at);
    return this.data.subarray(0, this.at);
  }
}
