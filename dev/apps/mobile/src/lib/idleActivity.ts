type ActivityListener = () => void;

const listeners = new Set<ActivityListener>();

/** A touch or keystroke inside Upriv. Focus and returning to the app are not activity. */
export function noteIdleActivity(): void {
  for (const listener of listeners) listener();
}

export function subscribeIdleActivity(listener: ActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
