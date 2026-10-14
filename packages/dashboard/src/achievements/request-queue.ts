export function createAchievementRequestQueue<I, O>(request: (input: I) => Promise<O>): (input: I) => Promise<O> {
  let tail: Promise<void> = Promise.resolve();
  return input => {
    const result = tail.then(() => request(input));
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
